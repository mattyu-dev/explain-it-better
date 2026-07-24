import { createHash } from "node:crypto";

import type { PromptSpec, TargetProfile } from "../contracts.js";
import { analyzeTaskRequirements } from "../blueprint/index.js";
import type { PromptCandidate } from "./candidates.js";

export type CompatibilitySeverity = "error" | "warning";

export interface CompatibilityIssue {
  code: string;
  severity: CompatibilitySeverity;
  message: string;
  targetId: string;
  ruleId: string;
}

export interface CompatibilityContext {
  prompt: PromptSpec;
  candidate: PromptCandidate;
  profile: TargetProfile;
  requestedReasoningMode?: string;
  requestedRoles?: Array<"system" | "developer" | "user" | "assistant" | "tool">;
  estimatedInputTokens?: number;
}

export interface CompatibilityRule {
  id: string;
  check(context: CompatibilityContext): CompatibilityIssue[];
}

export class CompatibilityError extends Error {
  readonly issues: CompatibilityIssue[];

  constructor(issues: CompatibilityIssue[]) {
    super(
      `Target compatibility failed: ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ")}`,
    );
    this.name = "CompatibilityError";
    this.issues = issues;
  }
}

function issue(
  context: CompatibilityContext,
  ruleId: string,
  code: string,
  severity: CompatibilitySeverity,
  message: string,
): CompatibilityIssue {
  return { code, severity, message, targetId: context.profile.id, ruleId };
}

function normalizedInstruction(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function contradictoryInstruction(context: CompatibilityContext): string | undefined {
  const values = [
    context.prompt.demand.objective,
    ...context.prompt.demand.deliverables,
    ...context.prompt.demand.constraints,
    ...context.prompt.demand.preferences,
    ...context.prompt.demand.exclusions,
  ].map(normalizedInstruction);
  const positive = new Set(
    // The original brief is preserved as the objective, so it can contain a
    // positive request followed by an exclusion. Treat such mixed prose as
    // context rather than a standalone positive instruction; only an
    // independently positive field may contradict an explicit exclusion.
    values.filter((value) => !/\b(?:do not|dont|never|must not)\b/u.test(value)),
  );
  for (const value of values) {
    const match = /^(?:do not|dont|never|must not)\s+(.+)$/u.exec(value);
    const negated = match?.[1];
    if (
      negated !== undefined &&
      [...positive].some(
        (candidate) => candidate === negated || candidate.endsWith(` ${negated}`),
      )
    ) {
      return negated;
    }
  }
  return undefined;
}

const capabilityRule: CompatibilityRule = {
  id: "builtin.capabilities",
  check(context) {
    const requirements = analyzeTaskRequirements(context.prompt.demand);
    const issues: CompatibilityIssue[] = [];
    if (requirements.structuredOutput && !context.profile.supports.structuredOutput) {
      issues.push(
        issue(
          context,
          this.id,
          "STRUCTURED_OUTPUT_UNSUPPORTED",
          "error",
          "The intent requires structured output but the target does not support it.",
        ),
      );
    }
    if (requirements.image && !context.profile.supports.image) {
      issues.push(
        issue(
          context,
          this.id,
          "IMAGE_UNSUPPORTED",
          "error",
          "The intent requires image capability but the target does not support images.",
        ),
      );
    }
    if (requirements.video && !context.profile.supports.video) {
      issues.push(
        issue(
          context,
          this.id,
          "VIDEO_UNSUPPORTED",
          "error",
          "The intent requires video capability but the target does not support video.",
        ),
      );
    }
    return issues;
  },
};

const configurationRule: CompatibilityRule = {
  id: "builtin.configuration",
  check(context) {
    const issues: CompatibilityIssue[] = [];
    if (
      context.requestedReasoningMode &&
      !context.profile.reasoning.modes.includes(context.requestedReasoningMode)
    ) {
      issues.push(
        issue(
          context,
          this.id,
          "REASONING_MODE_UNSUPPORTED",
          "error",
          `Reasoning mode "${context.requestedReasoningMode}" is not supported by this target.`,
        ),
      );
    }
    for (const role of context.requestedRoles ?? []) {
      if (!context.profile.roles.includes(role)) {
        issues.push(
          issue(
            context,
            this.id,
            "ROLE_UNSUPPORTED",
            "error",
            `Message role "${role}" is not supported by this target.`,
          ),
        );
      }
    }
    if (
      context.estimatedInputTokens !== undefined &&
      context.estimatedInputTokens > context.profile.contextWindow
    ) {
      issues.push(
        issue(
          context,
          this.id,
          "CONTEXT_WINDOW_EXCEEDED",
          "error",
          `Estimated input (${context.estimatedInputTokens} tokens) exceeds the ${context.profile.contextWindow}-token context window.`,
        ),
      );
    }
    return issues;
  },
};

const semanticBoundaryRule: CompatibilityRule = {
  id: "builtin.semantic-boundary",
  check(context) {
    const issues: CompatibilityIssue[] = [];
    const contradiction = contradictoryInstruction(context);
    if (contradiction !== undefined) {
      issues.push(
        issue(
          context,
          this.id,
          "CONTRADICTORY_INSTRUCTIONS",
          "error",
          `The frozen intent both requires and forbids "${contradiction}".`,
        ),
      );
    }
    if (/<\|(?:begin|end|system|user|assistant|im_start|im_end)[^>]*\|>/iu.test(context.candidate.semanticPrompt)) {
      issues.push(
        issue(
          context,
          this.id,
          "RAW_CONTROL_TOKEN",
          "error",
          "The provider-neutral candidate contains raw chat-template control tokens.",
        ),
      );
    }
    if (
      createHash("sha256").update(context.candidate.semanticPrompt).digest("hex") !==
      context.candidate.promptHash
    ) {
      issues.push(
        issue(
          context,
          this.id,
          "PROMPT_HASH_MISMATCH",
          "error",
          "The candidate prompt no longer matches its recorded digest.",
        ),
      );
    }
    if (context.profile.forbiddenCombinations.length > 0) {
      issues.push(
        issue(
          context,
          this.id,
          "TARGET_RESTRICTIONS_PRESENT",
          "warning",
          `Target-specific restrictions require serializer validation: ${context.profile.forbiddenCombinations.join("; ")}`,
        ),
      );
    }
    return issues;
  },
};

export const BUILTIN_COMPATIBILITY_RULES: readonly CompatibilityRule[] = [
  capabilityRule,
  configurationRule,
  semanticBoundaryRule,
];

function lintCompatibilityContext(
  context: CompatibilityContext,
  rules: readonly CompatibilityRule[] = [],
): CompatibilityIssue[] {
  return [...BUILTIN_COMPATIBILITY_RULES, ...rules].flatMap((rule) => rule.check(context));
}

export interface TargetLintOptions {
  candidate?: PromptCandidate;
  requestedReasoningMode?: string;
  requestedRoles?: CompatibilityContext["requestedRoles"];
  estimatedInputTokens?: number;
  rules?: readonly CompatibilityRule[];
}

function defaultLintCandidate(prompt: PromptSpec): PromptCandidate {
  const semanticPrompt = prompt.demand.objective;
  return {
    id: `${prompt.id}-lint`,
    dimension: "baseline",
    promptSpecId: prompt.id,
    semanticPrompt,
    promptHash: createHash("sha256").update(semanticPrompt).digest("hex"),
    changeLog: ["Synthetic lint candidate."],
  };
}

export function lintCompatibility(
  context: CompatibilityContext,
  rules?: readonly CompatibilityRule[],
): CompatibilityIssue[];
export function lintCompatibility(
  prompt: PromptSpec,
  profile: TargetProfile,
  options?: TargetLintOptions,
): CompatibilityIssue[];
export function lintCompatibility(
  contextOrPrompt: CompatibilityContext | PromptSpec,
  rulesOrProfile: readonly CompatibilityRule[] | TargetProfile = [],
  options: TargetLintOptions = {},
): CompatibilityIssue[] {
  if ("candidate" in contextOrPrompt && "profile" in contextOrPrompt) {
    return lintCompatibilityContext(
      contextOrPrompt,
      Array.isArray(rulesOrProfile)
        ? (rulesOrProfile as readonly CompatibilityRule[])
        : [],
    );
  }
  if (Array.isArray(rulesOrProfile)) {
    throw new Error("A target profile is required when linting a prompt specification.");
  }
  const profile = rulesOrProfile as TargetProfile;
  const context: CompatibilityContext = {
    prompt: contextOrPrompt,
    candidate: options.candidate ?? defaultLintCandidate(contextOrPrompt),
    profile,
    ...(options.requestedReasoningMode
      ? { requestedReasoningMode: options.requestedReasoningMode }
      : {}),
    ...(options.requestedRoles ? { requestedRoles: options.requestedRoles } : {}),
    ...(options.estimatedInputTokens !== undefined
      ? { estimatedInputTokens: options.estimatedInputTokens }
      : {}),
  };
  return lintCompatibilityContext(context, options.rules);
}

export function assertCompatible(issues: readonly CompatibilityIssue[]): void {
  const errors = issues.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new CompatibilityError([...issues]);
  }
}

import type { PromptSpec, TargetProfile } from "../contracts.js";
import type { PromptCandidate } from "./candidates.js";
import { generatePromptCandidates } from "./candidates.js";
import {
  assertCompatible,
  lintCompatibility,
  type CompatibilityRule,
} from "./lint.js";
import {
  RendererRegistry,
  type RenderedTarget,
  type TargetRenderer,
  type TargetRenderContext,
} from "./renderer.js";

export interface CompileCandidateOptions {
  requestedReasoningMode?: string;
  requestedRoles?: Array<"system" | "developer" | "user" | "assistant" | "tool">;
  estimatedInputTokens?: number;
  rules?: readonly CompatibilityRule[];
}

function estimatePromptTokens(prompt: string): number {
  // A code-point upper bound is deliberately conservative across languages and
  // avoids compiling an obviously oversized prompt when no tokenizer is bound.
  return Array.from(prompt).length + 16;
}

/**
 * Lints before rendering and refuses to compile when any required target
 * capability would be lost.
 */
export function compileCandidate(
  registry: RendererRegistry,
  prompt: PromptSpec,
  candidate: PromptCandidate,
  profile: TargetProfile,
  options: CompileCandidateOptions = {},
): RenderedTarget {
  if (candidate.promptSpecId !== prompt.id) {
    throw new Error(
      `Candidate "${candidate.id}" belongs to prompt specification "${candidate.promptSpecId}", not "${prompt.id}".`,
    );
  }
  const estimatedInputTokens =
    options.estimatedInputTokens ?? estimatePromptTokens(candidate.semanticPrompt);
  if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 0) {
    throw new Error("Estimated input tokens must be a non-negative safe integer.");
  }
  const lintContext = {
    prompt,
    candidate,
    profile,
    ...(options.requestedReasoningMode
      ? { requestedReasoningMode: options.requestedReasoningMode }
      : {}),
    ...(options.requestedRoles ? { requestedRoles: options.requestedRoles } : {}),
    estimatedInputTokens,
  };
  const issues = lintCompatibility(lintContext, options.rules);
  assertCompatible(issues);
  const renderer = registry.resolve(profile);
  const renderContext: TargetRenderContext = {
    prompt,
    candidate,
    profile,
    compatibilityIssues: issues,
    ...(options.requestedReasoningMode
      ? { requestedReasoningMode: options.requestedReasoningMode }
      : {}),
  };
  const rendered = renderer.render(renderContext);
  if (rendered.targetId !== profile.id) {
    throw new Error(
      `Renderer "${renderer.id}" returned target "${rendered.targetId}" for requested target "${profile.id}".`,
    );
  }
  if (!rendered.content.trim()) {
    throw new Error(`Renderer "${renderer.id}" returned empty content.`);
  }
  if (
    !rendered.filename.trim() ||
    rendered.filename.startsWith("/") ||
    rendered.filename.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`Renderer "${renderer.id}" returned an unsafe artifact filename.`);
  }
  if (!rendered.mimeType.trim()) {
    throw new Error(`Renderer "${renderer.id}" returned an empty MIME type.`);
  }
  const lintWarnings = issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);
  return {
    ...rendered,
    warnings: [...new Set([...rendered.warnings, ...lintWarnings])],
    appliedRuleIds: [
      ...new Set([...rendered.appliedRuleIds, ...issues.map((issue) => issue.ruleId)]),
    ],
  };
}

export interface TargetCompilationRules extends CompileCandidateOptions {
  renderer: TargetRenderer | RendererRegistry;
  candidate?: PromptCandidate;
}

/**
 * Concise public compiler entrypoint. Provider adapters supply the exact
 * serializer, while this core owns candidate generation and fail-closed linting.
 */
export function compileForTarget(
  prompt: PromptSpec,
  profile: TargetProfile,
  rules: TargetCompilationRules,
): RenderedTarget {
  const registry =
    rules.renderer instanceof RendererRegistry
      ? rules.renderer
      : new RendererRegistry([rules.renderer]);
  const candidate = rules.candidate ?? generatePromptCandidates(prompt, { maxCandidates: 1 })[0];
  if (!candidate) {
    throw new Error("Candidate generation produced no result.");
  }
  return compileCandidate(registry, prompt, candidate, profile, {
    ...(rules.requestedReasoningMode
      ? { requestedReasoningMode: rules.requestedReasoningMode }
      : {}),
    ...(rules.requestedRoles ? { requestedRoles: rules.requestedRoles } : {}),
    ...(rules.estimatedInputTokens !== undefined
      ? { estimatedInputTokens: rules.estimatedInputTokens }
      : {}),
    ...(rules.rules ? { rules: rules.rules } : {}),
  });
}

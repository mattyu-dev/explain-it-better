import type { KnowledgeRule } from "@eib/core";
import { getTargetProfile, targetProfiles } from "./profiles.js";
import { knowledgeRules } from "./rules.js";
import {
  KnowledgeRuleConformanceReportSchema,
  RuleConformanceResultSchema,
  type KnowledgeRuleConformanceReport,
  type KnowledgeTargetProfile,
  type RuleConformanceResult,
} from "./schemas.js";

interface RuleAssertion {
  readonly condition: boolean;
  readonly evidence: string;
  readonly failure: string;
}

export interface RuleConformanceContext {
  readonly rule: KnowledgeRule;
  readonly profile: KnowledgeTargetProfile;
  readonly profiles: readonly KnowledgeTargetProfile[];
}

export type RuleConformanceCheck = (
  context: RuleConformanceContext,
) => readonly RuleAssertion[];

function assertion(
  condition: boolean,
  evidence: string,
  failure: string,
): RuleAssertion {
  return { condition, evidence, failure };
}

function ruleMentions(
  context: RuleConformanceContext,
  pattern: RegExp,
  subject: string,
): RuleAssertion {
  return assertion(
    pattern.test(context.rule.rule),
    `${context.rule.id} explicitly encodes ${subject}`,
    `${context.rule.id} does not explicitly encode ${subject}`,
  );
}

function textIncludes(
  value: string,
  pattern: RegExp,
  evidence: string,
  failure: string,
): RuleAssertion {
  return assertion(pattern.test(value), evidence, failure);
}

function textIncludesAll(
  value: string,
  terms: readonly string[],
  evidence: string,
  failure: string,
): RuleAssertion {
  const normalized = value.toLowerCase();
  return assertion(terms.every((term) => normalized.includes(term.toLowerCase())), evidence, failure);
}

function textIncludesAnyTermGroup(
  value: string,
  groups: readonly (readonly string[])[],
  evidence: string,
  failure: string,
): RuleAssertion {
  const normalized = value.toLowerCase();
  return assertion(
    groups.some((terms) => terms.every((term) => normalized.includes(term.toLowerCase()))),
    evidence,
    failure,
  );
}

export const ruleConformanceRegistry: Readonly<
  Record<string, RuleConformanceCheck>
> = {
  "openai-lean-nonduplicative-prompts": (context) => [
    ruleMentions(context, /state each policy once|redundant/i, "deduplication"),
  ],
  "openai-explicit-approval-boundaries": (context) => [
    textIncludes(
      context.profile.forbiddenCombinations.join(" "),
      /approval|permission/i,
      `${context.profile.id} records an approval or permission boundary`,
      `${context.profile.id} lacks an executable approval or permission boundary`,
    ),
  ],
  "openai-outcomes-not-hidden-reasoning": (context) => [
    ruleMentions(
      context,
      /rather than hidden chain-of-thought/i,
      "the hidden-reasoning boundary",
    ),
  ],
  "anthropic-clear-direct-instructions": (context) => [
    textIncludesAnyTermGroup(
      context.rule.rule,
      [["objective"], ["instructions", "output constraints"]],
      `${context.rule.id} explicitly encodes task and output requirements`,
      `${context.rule.id} does not explicitly encode task and output requirements`,
    ),
  ],
  "anthropic-xml-structure": (context) => [
    ruleMentions(context, /XML/i, "structured XML boundaries"),
  ],
  "anthropic-long-context-ordering": (context) => [
    assertion(
      context.profile.contextWindow >= 20_000,
      `${context.profile.id} supports the rule's long-context threshold`,
      `${context.profile.id} cannot exercise the long-context ordering rule`,
    ),
  ],
  "gemini-specific-instructions": (context) => [
    ruleMentions(context, /precise instructions/i, "specific instructions"),
  ],
  "gemini-native-parts": (context) => [
    assertion(
      context.profile.reasoning.preserveState,
      `${context.profile.id} preserves native reasoning state`,
      `${context.profile.id} does not preserve native reasoning state`,
    ),
    textIncludesAll(
      context.profile.continuationPolicy,
      ["parts", "thought signatures"],
      `${context.profile.id} preserves content parts and thought signatures`,
      `${context.profile.id} continuation policy omits native Gemini parts`,
    ),
  ],
  "xai-exact-model-variant": (context) => [
    assertion(
      !/latest|provider-selected/i.test(context.profile.model),
      `${context.profile.id} pins exact model ${context.profile.model}`,
      `${context.profile.id} does not pin an exact Grok model`,
    ),
  ],
  "xai-reasoning-effort": (context) => [
    assertion(
      ["low", "medium", "high"].every((mode) =>
        context.profile.reasoning.modes.includes(mode),
      ) && context.profile.reasoning.defaultMode === "high",
      `${context.profile.id} exposes low, medium, and high effort with high as the default`,
      `${context.profile.id} does not encode the documented Grok 4.5 effort contract`,
    ),
    textIncludesAll(
      context.profile.forbiddenCombinations.join(" "),
      ["cannot be disabled", "presencepenalty", "frequencypenalty", "stop"],
      `${context.profile.id} rejects disabled reasoning and incompatible parameters`,
      `${context.profile.id} omits a Grok 4.5 reasoning incompatibility`,
    ),
  ],
  "xai-independent-compatibility": (context) => [
    textIncludes(
      context.profile.notes.join(" "),
      /independently/i,
      `${context.profile.id} requires independent compatibility validation`,
      `${context.profile.id} could inherit another provider's compatibility`,
    ),
  ],
  "deepseek-separate-chat-reasoner": (context) => {
    const sibling = context.profiles.find(
      (profile) =>
        profile.provider === "deepseek" &&
        profile.id !== context.profile.id &&
        profile.surface === context.profile.surface,
    );
    return [
      assertion(
        sibling !== undefined &&
          sibling.model !== context.profile.model &&
          sibling.reasoning.defaultMode !==
            context.profile.reasoning.defaultMode,
        `${context.profile.id} has a distinct DeepSeek sibling contract`,
        `${context.profile.id} lacks a distinct chat/reasoner sibling contract`,
      ),
    ];
  },
  "deepseek-openai-subset": (context) => [
    textIncludes(
      `${context.profile.serialization} ${context.profile.forbiddenCombinations.join(" ")}`,
      /unsupported|documented.*subset|independently from OpenAI/i,
      `${context.profile.id} fails closed on undocumented compatibility`,
      `${context.profile.id} does not fail closed on undocumented compatibility`,
    ),
  ],
  "llama-template-is-deployment-specific": (context) => [
    assertion(
      context.profile.apiStyle === "chat_template",
      `${context.profile.id} delegates to a chat-template serializer`,
      `${context.profile.id} does not use a chat-template serializer`,
    ),
  ],
  "llama-capabilities-require-probe": (context) => [
    textIncludes(
      context.profile.forbiddenCombinations.join(" "),
      /probe/i,
      `${context.profile.id} gates deployment capabilities on a probe`,
      `${context.profile.id} enables deployment capabilities without a probe`,
    ),
  ],
  "mistral-role-structured-prompt": (context) => [
    assertion(
      context.profile.roles.includes("system") &&
        context.profile.roles.includes("user"),
      `${context.profile.id} supports separate system and user instructions`,
      `${context.profile.id} cannot preserve system/user instruction separation`,
    ),
  ],
  "mistral-template-boundary": (context) => [
    assertion(
      context.profile.apiStyle === "chat_template",
      `${context.profile.id} keeps template control in its serializer`,
      `${context.profile.id} does not declare a deployment chat-template boundary`,
    ),
  ],
  "kimi-clear-detailed-sections": (context) => [
    ruleMentions(context, /delimit|output constraints/i, "prompt sections"),
  ],
  "kimi-k3-always-thinking": (context) => [
    assertion(
      !context.profile.reasoning.modes.some((mode) =>
        /instant|disabled|non-reasoning/i.test(mode),
      ),
      `${context.profile.id} exposes no non-thinking mode`,
      `${context.profile.id} incorrectly exposes a non-thinking mode`,
    ),
  ],
  "kimi-k3-fixed-sampling": (context) => {
    const fixed = new Map(
      context.profile.parameterRules.map((rule) => [rule.name, rule]),
    );
    return [
      assertion(
        fixed.get("temperature")?.fixedValue === 1 &&
          fixed.get("top_p")?.fixedValue === 0.95 &&
          fixed.get("n")?.fixedValue === 1,
        `${context.profile.id} encodes all fixed hosted sampling values`,
        `${context.profile.id} is missing a fixed hosted sampling value`,
      ),
      assertion(
        ["temperature", "top_p", "n"].every(
          (name) => fixed.get(name)?.omitWhenFixed === true,
        ),
        `${context.profile.id} omits fixed sampling parameters`,
        `${context.profile.id} may redundantly send fixed sampling parameters`,
      ),
    ];
  },
  "kimi-k3-tool-state": (context) => [
    textIncludes(
      context.profile.continuationPolicy,
      /complete assistant message unchanged/i,
      `${context.profile.id} preserves the complete assistant tool state`,
      `${context.profile.id} may lose native assistant tool state`,
    ),
  ],
  "kimi-k3-dynamic-tools": (context) => [
    assertion(
      context.profile.toolCapabilities.dynamicLoading,
      `${context.profile.id} explicitly enables position-sensitive dynamic tools`,
      `${context.profile.id} does not enable dynamic tool loading`,
    ),
  ],
  "kimi-k2-7-thinking-only": (context) => [
    assertion(
      context.profile.reasoning.modes.length === 1 &&
        !context.profile.reasoning.modes.some((mode) =>
          /instant|disabled|non-thinking/i.test(mode),
        ),
      `${context.profile.id} exposes thinking-only behavior`,
      `${context.profile.id} incorrectly exposes non-thinking behavior`,
    ),
  ],
  "kimi-k2-6-thinking-instant": (context) => [
    assertion(
      context.profile.reasoning.modes.includes("thinking") &&
        context.profile.reasoning.modes.includes("instant"),
      `${context.profile.id} exposes both thinking and instant modes`,
      `${context.profile.id} does not expose both K2.6 modes`,
    ),
  ],
  "kimi-hosted-self-hosted-separation": (context) => [
    assertion(
      context.profile.deployment.mode === "self_hosted" &&
        Object.values(context.profile.supports).every(
          (supported) => supported === false,
        ),
      `${context.profile.id} conservatively disables unprobed hosted guarantees`,
      `${context.profile.id} inherits an unprobed hosted capability`,
    ),
  ],
  "kimi-code-target-only": (context) => [
    assertion(
      context.profile.availability === "target_only",
      `${context.profile.id} is target-only`,
      `${context.profile.id} is incorrectly enabled as a backend`,
    ),
  ],
  "hermes-target-only": (context) => [
    assertion(
      context.profile.availability === "target_only",
      `${context.profile.id} is target-only`,
      `${context.profile.id} is incorrectly enabled as a backend`,
    ),
  ],
};

function isApplicable(
  rule: KnowledgeRule,
  profile: KnowledgeTargetProfile,
): boolean {
  return (
    rule.scope.provider === profile.provider &&
    rule.scope.surfaces.includes(profile.surface) &&
    (rule.scope.models.includes("*") ||
      rule.scope.models.includes(profile.model))
  );
}

function resolveRule(ruleOrId: string | KnowledgeRule): KnowledgeRule {
  if (typeof ruleOrId !== "string") {
    return ruleOrId;
  }
  const rule = knowledgeRules.find((candidate) => candidate.id === ruleOrId);
  if (rule === undefined) {
    throw new Error(`Unknown knowledge rule: ${ruleOrId}`);
  }
  return rule;
}

export function runRuleConformance(
  ruleOrId: string | KnowledgeRule,
  profileOrId: string | KnowledgeTargetProfile,
  profiles: readonly KnowledgeTargetProfile[] = targetProfiles,
): RuleConformanceResult {
  const rule = resolveRule(ruleOrId);
  const profile =
    typeof profileOrId === "string"
      ? getTargetProfile(profileOrId)
      : profileOrId;
  if (!isApplicable(rule, profile)) {
    throw new Error(`Rule ${rule.id} does not apply to profile ${profile.id}`);
  }
  const handler = ruleConformanceRegistry[rule.id];
  if (handler === undefined) {
    return RuleConformanceResultSchema.parse({
      ruleId: rule.id,
      profileId: profile.id,
      passed: false,
      evidence: [],
      failures: [`No executable conformance handler for rule ${rule.id}`],
    });
  }
  const assertions = handler({ rule, profile, profiles });
  const evidence = assertions
    .filter((entry) => entry.condition)
    .map((entry) => entry.evidence);
  const failures = assertions
    .filter((entry) => !entry.condition)
    .map((entry) => entry.failure);
  return RuleConformanceResultSchema.parse({
    ruleId: rule.id,
    profileId: profile.id,
    passed: failures.length === 0 && assertions.length > 0,
    evidence,
    failures:
      assertions.length === 0
        ? [`Conformance handler for ${rule.id} made no assertions`]
        : failures,
  });
}

export interface KnowledgeRuleConformanceOptions {
  readonly profiles?: readonly KnowledgeTargetProfile[];
  readonly rules?: readonly KnowledgeRule[];
}

export function runKnowledgeRuleConformance(
  options: KnowledgeRuleConformanceOptions = {},
): KnowledgeRuleConformanceReport {
  const profiles = options.profiles ?? targetProfiles;
  const rules = options.rules ?? knowledgeRules;
  const results: RuleConformanceResult[] = [];
  const missingHandlerRuleIds = rules
    .filter((rule) => ruleConformanceRegistry[rule.id] === undefined)
    .map((rule) => rule.id);
  const unappliedRuleIds: string[] = [];

  for (const rule of rules) {
    const applicableProfiles = profiles.filter((profile) =>
      isApplicable(rule, profile),
    );
    if (applicableProfiles.length === 0) {
      unappliedRuleIds.push(rule.id);
      continue;
    }
    for (const profile of applicableProfiles) {
      results.push(runRuleConformance(rule, profile, profiles));
    }
  }

  return KnowledgeRuleConformanceReportSchema.parse({
    valid:
      missingHandlerRuleIds.length === 0 &&
      unappliedRuleIds.length === 0 &&
      results.every((result) => result.passed),
    results,
    missingHandlerRuleIds,
    unappliedRuleIds,
  });
}

export const runAllRuleConformance = runKnowledgeRuleConformance;

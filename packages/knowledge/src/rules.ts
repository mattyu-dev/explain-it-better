import { KnowledgeRuleSchema, type KnowledgeRule } from "@eib/core";
import type { KnowledgeTargetProfile } from "./schemas.js";
import { getTargetProfile } from "./profiles.js";
import { getKnowledgeSource } from "./sources.js";

const VERIFIED_AT = "2026-07-24T00:00:00.000Z";

interface RuleInput {
  readonly id: string;
  readonly provider: KnowledgeRule["scope"]["provider"];
  readonly models: string[];
  readonly surfaces: KnowledgeRule["scope"]["surfaces"];
  readonly rule: string;
  readonly sourceId: string;
  readonly confidence?: KnowledgeRule["confidence"];
  readonly conflicts?: string[];
  readonly conformanceTest: string;
}

function reviewedRule(input: RuleInput): KnowledgeRule {
  const source = getKnowledgeSource(input.sourceId);
  if (source.provider !== input.provider) {
    throw new Error(
      `Rule ${input.id} provider ${input.provider} does not match source ${source.id}`,
    );
  }
  return KnowledgeRuleSchema.parse({
    id: input.id,
    scope: {
      provider: input.provider,
      models: input.models,
      surfaces: input.surfaces,
    },
    rule: input.rule,
    sourceUrl: source.url,
    sourceHash: source.contentHash,
    verifiedAt: VERIFIED_AT,
    confidence: input.confidence ?? "high",
    conflicts: input.conflicts ?? [],
    conformanceTest: input.conformanceTest,
  });
}

export const knowledgeRules: readonly KnowledgeRule[] = [
  reviewedRule({
    id: "openai-lean-nonduplicative-prompts",
    provider: "openai",
    models: ["gpt-5.6"],
    surfaces: ["api", "chat_app", "coding_cli"],
    rule:
      "State each policy once, keep tool descriptions precise, and remove redundant instructions only against representative evals.",
    sourceId: "openai-model-guidance",
    conformanceTest:
      "Prompt lint reports repeated normative instructions and requires an eval before removing product requirements.",
  }),
  reviewedRule({
    id: "openai-explicit-approval-boundaries",
    provider: "openai",
    models: ["gpt-5.6"],
    surfaces: ["api", "coding_cli"],
    rule:
      "Name safe in-scope actions and separately require confirmation for destructive, external, costly, or scope-expanding actions.",
    sourceId: "openai-model-guidance",
    conformanceTest:
      "Compiled agent policy includes both autonomous local actions and explicit approval gates.",
  }),
  reviewedRule({
    id: "openai-outcomes-not-hidden-reasoning",
    provider: "openai",
    models: ["gpt-5.6"],
    surfaces: ["api", "chat_app", "coding_cli"],
    rule:
      "Request conclusions, evidence, assumptions, and verification results rather than hidden chain-of-thought.",
    sourceId: "openai-model-guidance",
    conformanceTest:
      "Security lint rejects requests to reveal private chain-of-thought.",
  }),
  reviewedRule({
    id: "anthropic-clear-direct-instructions",
    provider: "anthropic",
    models: ["claude-sonnet-5"],
    surfaces: ["api", "chat_app", "coding_cli"],
    rule:
      "Give Claude clear, direct, detailed instructions and state the output constraints and success criteria explicitly.",
    sourceId: "anthropic-prompting-best-practices",
    conformanceTest:
      "Compiled prompt includes objective, constraints, and an observable output contract.",
  }),
  reviewedRule({
    id: "anthropic-xml-structure",
    provider: "anthropic",
    models: ["claude-sonnet-5"],
    surfaces: ["api", "chat_app", "coding_cli"],
    rule:
      "Use consistently named XML sections when they clarify the boundaries between instructions, context, examples, and input.",
    sourceId: "anthropic-prompting-best-practices",
    conformanceTest:
      "Any emitted XML tags are balanced and each section has one semantic purpose.",
  }),
  reviewedRule({
    id: "anthropic-long-context-ordering",
    provider: "anthropic",
    models: ["claude-sonnet-5"],
    surfaces: ["api"],
    rule:
      "Place long source material before the final query and ask for relevant quotations or evidence before synthesis when grounding matters.",
    sourceId: "anthropic-prompting-best-practices",
    conformanceTest:
      "Long-context artifact orders source context before the task-specific final instruction.",
  }),
  reviewedRule({
    id: "gemini-specific-instructions",
    provider: "google",
    models: ["gemini-3.1-pro"],
    surfaces: ["api"],
    rule:
      "Use precise instructions, define constraints and output shape, and add representative few-shot examples only when needed.",
    sourceId: "google-gemini-prompting",
    conformanceTest:
      "Compiled Gemini request has a direct task instruction and no placeholder examples.",
  }),
  reviewedRule({
    id: "gemini-native-parts",
    provider: "google",
    models: ["gemini-3.1-pro"],
    surfaces: ["api"],
    rule:
      "Preserve Gemini-native content parts and thought signatures across multi-turn and tool interactions.",
    sourceId: "google-gemini-prompting",
    conformanceTest:
      "Serializer round-trip retains all opaque native parts in their original order.",
  }),
  reviewedRule({
    id: "xai-exact-model-variant",
    provider: "xai",
    models: ["grok-4.5"],
    surfaces: ["api"],
    rule:
      "Compile against the exact Grok 4.5 model rather than a moving latest alias.",
    sourceId: "xai-models",
    conformanceTest:
      "Target lint rejects an unspecified Grok model or mismatched reasoning mode.",
  }),
  reviewedRule({
    id: "xai-reasoning-effort",
    provider: "xai",
    models: ["grok-4.5"],
    surfaces: ["api"],
    rule:
      "Select low, medium, or high reasoning effort for Grok 4.5; reasoning cannot be disabled and incompatible penalty or stop parameters must fail closed.",
    sourceId: "xai-reasoning",
    conformanceTest:
      "Target lint accepts only documented effort levels and rejects parameters incompatible with reasoning.",
  }),
  reviewedRule({
    id: "xai-independent-compatibility",
    provider: "xai",
    models: ["grok-4.5"],
    surfaces: ["api"],
    rule:
      "Validate xAI roles, reasoning, tools, schemas, and modality directly; transport similarity does not imply OpenAI feature parity.",
    sourceId: "xai-models",
    conformanceTest:
      "xAI adapter golden tests run independently of the OpenAI adapter fixtures.",
  }),
  reviewedRule({
    id: "deepseek-separate-chat-reasoner",
    provider: "deepseek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    surfaces: ["api"],
    rule:
      "Treat deepseek-chat and deepseek-reasoner as separate model contracts with independent reasoning and parameter behavior.",
    sourceId: "deepseek-api-docs",
    conformanceTest:
      "Selecting a reasoning mode unsupported by the chosen DeepSeek profile fails compilation.",
  }),
  reviewedRule({
    id: "deepseek-openai-subset",
    provider: "deepseek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    surfaces: ["api"],
    rule:
      "Use only DeepSeek-documented OpenAI-compatible request fields and fail closed instead of dropping unsupported fields.",
    sourceId: "deepseek-api-docs",
    conformanceTest:
      "Unknown or unsupported request fields produce an error, not a warning-only downgrade.",
  }),
  reviewedRule({
    id: "llama-template-is-deployment-specific",
    provider: "meta",
    models: ["Llama-4-Maverick-17B-128E-Instruct-FP8"],
    surfaces: ["open_weights"],
    rule:
      "Keep Llama control tokens and chat templates out of the semantic blueprint and resolve them in the deployment serializer.",
    sourceId: "meta-llama-models",
    conformanceTest:
      "Neutral blueprint snapshots contain no tokenizer control-token syntax.",
  }),
  reviewedRule({
    id: "llama-capabilities-require-probe",
    provider: "meta",
    models: ["Llama-4-Maverick-17B-128E-Instruct-FP8"],
    surfaces: ["open_weights"],
    rule:
      "Require a deployment capability probe before enabling tool parsing, structured output, prompt caching, or hosted-only modality behavior.",
    sourceId: "meta-llama-models",
    conformanceTest:
      "Unprobed open-weight configurations fail when requesting deployment-dependent capabilities.",
  }),
  reviewedRule({
    id: "mistral-role-structured-prompt",
    provider: "mistral",
    models: ["mistral-large-3-25-12"],
    surfaces: ["api", "open_weights"],
    rule:
      "Separate durable system behavior from the current user task, structure instructions clearly, and use explicit examples or output constraints when they improve task accuracy or output format.",
    sourceId: "mistral-prompting",
    conformanceTest:
      "Mistral artifact preserves system/user separation and validates output requirements.",
  }),
  reviewedRule({
    id: "mistral-template-boundary",
    provider: "mistral",
    models: ["mistral-large-3-25-12"],
    surfaces: ["open_weights"],
    rule:
      "Resolve Mistral tokenizer control tokens only in the selected self-hosted serializer.",
    sourceId: "mistral-prompting",
    conformanceTest:
      "Semantic prompt snapshots contain no raw Mistral template tokens.",
  }),
  reviewedRule({
    id: "kimi-clear-detailed-sections",
    provider: "kimi",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
    surfaces: ["api", "coding_cli", "open_weights"],
    rule:
      "Give Kimi clear detailed instructions, delimit independent input sections, and define multi-step workflows and output constraints explicitly.",
    sourceId: "kimi-prompting",
    conformanceTest:
      "Kimi prompt artifact separates instructions, supplied context, and output contract.",
  }),
  reviewedRule({
    id: "kimi-k3-always-thinking",
    provider: "kimi",
    models: ["kimi-k3"],
    surfaces: ["api", "open_weights"],
    rule:
      "Kimi K3 always thinks; hosted requests may select low, high, or max reasoning_effort but cannot disable thinking.",
    sourceId: "kimi-k3-guide",
    conformanceTest:
      "K3 target lint rejects null, disabled, instant, or non-thinking reasoning modes.",
  }),
  reviewedRule({
    id: "kimi-k3-fixed-sampling",
    provider: "kimi",
    models: ["kimi-k3"],
    surfaces: ["api"],
    rule:
      "Hosted Kimi K3 fixes temperature=1, top_p=0.95, n=1, and zero penalties; omit fixed parameters rather than attempting to tune them.",
    sourceId: "kimi-k3-guide",
    conformanceTest:
      "Conformance rejects non-fixed values and warns when fixed hosted values are redundantly sent.",
  }),
  reviewedRule({
    id: "kimi-k3-tool-state",
    provider: "kimi",
    models: ["kimi-k3"],
    surfaces: ["api"],
    rule:
      "For multi-turn and tool calls, append the complete assistant message unchanged and match every tool result to its tool_call_id.",
    sourceId: "kimi-k3-guide",
    conformanceTest:
      "Tool-loop fixture round-trips reasoning_content, content, and all tool calls.",
  }),
  reviewedRule({
    id: "kimi-k3-dynamic-tools",
    provider: "kimi",
    models: ["kimi-k3"],
    surfaces: ["api"],
    rule:
      "Dynamic tool definitions are position-sensitive system messages and must remain in later request history.",
    sourceId: "kimi-k3-guide",
    conformanceTest:
      "Dynamic-tool fixture retains its full definition at the original message position.",
  }),
  reviewedRule({
    id: "kimi-k2-7-thinking-only",
    provider: "kimi",
    models: ["kimi-k2.7-code"],
    surfaces: ["api", "coding_cli", "open_weights"],
    rule:
      "Kimi K2.7 Code supports thinking mode for long-horizon coding and does not support non-thinking mode.",
    sourceId: "kimi-k2-7-code-guide",
    conformanceTest:
      "K2.7 Code lint rejects instant and non-thinking reasoning modes.",
  }),
  reviewedRule({
    id: "kimi-k2-6-thinking-instant",
    provider: "kimi",
    models: ["kimi-k2.6"],
    surfaces: ["api", "open_weights"],
    rule:
      "Kimi K2.6 supports distinct thinking and instant modes; compile the requested behavior explicitly.",
    sourceId: "kimi-k2-6-guide",
    conformanceTest:
      "K2.6 lint accepts thinking or instant and rejects other reasoning modes.",
  }),
  reviewedRule({
    id: "kimi-hosted-self-hosted-separation",
    provider: "kimi",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
    surfaces: ["open_weights"],
    rule:
      "Do not inherit hosted Kimi multimodality, strict schemas, tool parsing, caching, or chat-template guarantees in a self-hosted deployment.",
    sourceId: "kimi-overview",
    conformanceTest:
      "Unprobed self-hosted Kimi profiles reject hosted-only capabilities.",
  }),
  reviewedRule({
    id: "kimi-code-target-only",
    provider: "kimi",
    models: ["kimi-k2.7-code"],
    surfaces: ["coding_cli"],
    rule:
      "Kimi Code remains an export target until a local doctor probe verifies installation, authentication, isolation, and a safe invocation.",
    sourceId: "kimi-code-repository",
    conformanceTest:
      "Doctor leaves Kimi backend disabled unless every required probe passes.",
  }),
  reviewedRule({
    id: "hermes-target-only",
    provider: "hermes",
    models: ["provider-selected"],
    surfaces: ["agent_cli"],
    rule:
      "Hermes remains an export target and must not be used as a compiler or evaluator backend without a verifiable zero-tools safe mode.",
    sourceId: "hermes-agent-repository",
    conformanceTest:
      "Backend registry contains no enabled Hermes compiler or live evaluator.",
  }),
];

export function getRulesForProfile(
  profileOrId: string | KnowledgeTargetProfile,
): KnowledgeRule[] {
  const profile =
    typeof profileOrId === "string"
      ? getTargetProfile(profileOrId)
      : profileOrId;
  return knowledgeRules.filter((rule) => {
    return (
      rule.scope.provider === profile.provider &&
      rule.scope.surfaces.includes(profile.surface) &&
      (rule.scope.models.includes("*") ||
        rule.scope.models.includes(profile.model))
    );
  });
}

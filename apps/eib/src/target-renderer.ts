import { compileForTarget, type PromptCandidate, type PromptSpec, type RenderedTarget, type TargetRenderer } from "@eib/core";
import {
  getRulesForProfile,
  getTargetProfile,
  validateTargetConfiguration,
  type KnowledgeTargetProfile,
} from "@eib/knowledge";
import { ExitCode as Codes } from "./args/types.js";
import { CliServiceError } from "./service-contracts.js";

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was cancelled.", "AbortError");
}

function targetFilename(profile: KnowledgeTargetProfile): string {
  if (profile.surface === "chat_app") return "prompt.md";
  if (profile.id.includes("codex")) return "AGENTS.md";
  if (profile.id.includes("claude-code")) return "CLAUDE.md";
  if (profile.id === "kimi-code-cli") return ".kimi/instructions.md";
  if (profile.provider === "hermes") return ".hermes/skills/explain-it-better/SKILL.md";
  return profile.surface === "open_weights" ? "deployment.json" : "request.json";
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function targetPolicy(profile: KnowledgeTargetProfile, prompt: PromptSpec): { readonly policy: readonly string[]; readonly ruleIds: readonly string[] } {
  const rules = getRulesForProfile(profile);
  return {
    policy: [...prompt.guidance.principles, ...rules.map((rule) => `Target-specific rule (${rule.id}): ${rule.rule}`)],
    ruleIds: rules.map((rule) => rule.id),
  };
}

function promptForProfile(profile: KnowledgeTargetProfile, semanticPrompt: string): string {
  return profile.provider === "anthropic" ? `<task>\n${escapeXml(semanticPrompt)}\n</task>` : semanticPrompt;
}

function surfaceAsset(profile: KnowledgeTargetProfile, semanticPrompt: string, prompt: PromptSpec, policy: readonly string[]): string {
  const guidance = ["## Target-specific guidance", ...policy.map((rule) => `- ${rule}`)].join("\n");
  const method = ["## Approach", ...prompt.guidance.method.map((step) => `- ${step}`)].join("\n");
  if (profile.surface === "chat_app") return [`# Paste-ready prompt for ${profile.model}`, promptForProfile(profile, semanticPrompt), method, guidance].join("\n\n");
  if (profile.id.includes("codex")) return ["# Explain It Better — Codex project prompt", "Use this prompt as project guidance; preserve higher-authority instructions.", semanticPrompt, method, guidance].join("\n\n");
  if (profile.id.includes("claude-code")) return ["# Explain It Better — Claude Code project instructions", "Treat these as project instructions and preserve higher-authority platform safety policy.", promptForProfile(profile, semanticPrompt), method, guidance].join("\n\n");
  if (profile.id === "kimi-code-cli") return ["# Explain It Better — Kimi Code project instructions", semanticPrompt, method, guidance].join("\n\n");
  if (profile.provider === "hermes") {
    return ["---", "name: explain-it-better-prompt", "description: Target-aware prompt generated from a human demand.", "---", "", "# Explain It Better prompt", "", semanticPrompt, "", method, "", guidance].join("\n");
  }
  return [semanticPrompt, method, guidance].join("\n\n");
}

function apiPayload(profile: KnowledgeTargetProfile, semanticPrompt: string, prompt: PromptSpec, policy: readonly string[]): unknown {
  const outputSchema = prompt.demand.outputContract.schema;
  const renderedPrompt = promptForProfile(profile, semanticPrompt);
  const renderedPolicy = policy.join("\n");
  switch (profile.apiStyle) {
    case "responses":
      return { model: profile.model, instructions: renderedPolicy, input: renderedPrompt, reasoning: { effort: profile.reasoning.defaultMode }, ...(outputSchema === undefined ? {} : { text: { format: { type: "json_schema", name: "result", schema: outputSchema } } }) };
    case "messages":
      return { model: profile.model, system: renderedPolicy, messages: [{ role: "user", content: renderedPrompt }], thinking: { type: profile.reasoning.defaultMode }, ...(outputSchema === undefined ? {} : { output_config: { format: { type: "json_schema", schema: outputSchema } } }) };
    case "generate_content":
      return { model: profile.model, systemInstruction: { parts: [{ text: renderedPolicy }] }, contents: [{ role: "user", parts: [{ text: renderedPrompt }] }], generationConfig: { thinkingConfig: { thinkingLevel: profile.reasoning.defaultMode.toUpperCase() }, ...(outputSchema === undefined ? {} : { responseMimeType: "application/json", responseSchema: outputSchema }) } };
    case "openai_compatible":
      return {
        model: profile.model,
        messages: [{ role: "system", content: renderedPolicy }, { role: "user", content: renderedPrompt }],
        ...(outputSchema === undefined ? {} : { response_format: { type: "json_schema", json_schema: { name: "result", schema: outputSchema } } }),
        ...(profile.provider === "kimi" && profile.model === "kimi-k3" ? { reasoning_effort: profile.reasoning.defaultMode } : {}),
        ...(profile.provider === "kimi" && profile.model === "kimi-k2.6" ? { thinking: { type: profile.reasoning.defaultMode === "instant" ? "disabled" : "enabled" } } : {}),
        ...(profile.provider === "kimi" && profile.model === "kimi-k2.7-code" ? { thinking: { type: "enabled" } } : {}),
      };
    case "chat_template":
      return { model: profile.model, endpoint: profile.endpoint, serializer: { strategy: "tokenizer.apply_chat_template", instructions: profile.serialization, rawControlTokensInSemanticPrompt: false }, messages: [{ role: "system", content: renderedPolicy }, { role: "user", content: renderedPrompt }], continuationPolicy: profile.continuationPolicy, capabilityProbeRequired: true, ...(outputSchema === undefined ? {} : { outputSchema }) };
    case "surface_asset":
      return surfaceAsset(profile, semanticPrompt, prompt, policy);
  }
}

function createTargetRenderer(profile: KnowledgeTargetProfile): TargetRenderer {
  return {
    id: `eib-cli-${profile.id}`,
    supports(candidate): boolean { return candidate.id === profile.id; },
    render(context): RenderedTarget {
      const filename = targetFilename(profile);
      const isJson = filename.endsWith(".json");
      const target = targetPolicy(profile, context.prompt);
      const payload = apiPayload(profile, context.candidate.semanticPrompt, context.prompt, target.policy);
      return {
        targetId: profile.id,
        filename,
        content: isJson ? `${JSON.stringify(payload, null, 2)}\n` : `${String(payload).trim()}\n`,
        mimeType: isJson ? "application/json" : "text/markdown",
        warnings: [...profile.notes, ...profile.forbiddenCombinations.map((value) => `Target restriction: ${value}`)],
        appliedRuleIds: [...target.ruleIds],
      };
    },
  };
}

/** Compile a prompt for reviewed target profiles without owning command lifecycle or persistence. */
export function compilePrompt(
  prompt: PromptSpec,
  targets: readonly string[],
  signal: AbortSignal,
  candidate?: PromptCandidate,
): RenderedTarget[] {
  return targets.map((targetId) => {
    assertNotAborted(signal);
    const profile = getTargetProfile(targetId);
    const roles = profile.apiStyle === "responses"
      ? ["developer", "user"] as const
      : profile.surface === "chat_app"
        ? ["user"] as const
        : profile.provider === "openai" && profile.surface === "coding_cli"
          ? ["developer", "user"] as const
          : ["system", "user"] as const;
    const estimatedInputTokens = Math.ceil(JSON.stringify(prompt.demand).length / 4);
    const conformance = validateTargetConfiguration(profile, {
      roles,
      reasoningMode: profile.reasoning.defaultMode,
      tools: false,
      structuredOutput: prompt.demand.outputContract.schema !== undefined,
      image: false,
      video: false,
      contextTokens: estimatedInputTokens,
      toolChoiceMode: null,
      dynamicTools: false,
      strictToolSchemas: false,
    });
    if (!conformance.valid) {
      throw new CliServiceError(`Target ${targetId} cannot represent this prompt's requested output.`, Codes.usage, conformance);
    }
    return compileForTarget(prompt, profile, {
      renderer: createTargetRenderer(profile),
      requestedReasoningMode: profile.reasoning.defaultMode,
      requestedRoles: [...roles],
      estimatedInputTokens,
      ...(candidate === undefined ? {} : { candidate }),
    });
  });
}

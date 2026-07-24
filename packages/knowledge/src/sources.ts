import type { SourceManifestEntry } from "./schemas.js";
import { SourceManifestEntrySchema } from "./schemas.js";

const REVIEWED_AT = "2026-07-24T00:00:00.000Z";

function source(
  value: Omit<
    SourceManifestEntry,
    "reviewStatus" | "reviewedAt" | "driftStrategy"
  > & {
    readonly driftStrategy?: SourceManifestEntry["driftStrategy"];
  },
): SourceManifestEntry {
  return SourceManifestEntrySchema.parse({
    ...value,
    reviewStatus: "reviewed",
    reviewedAt: REVIEWED_AT,
    driftStrategy: value.driftStrategy ?? "full_hash",
  });
}

export const sourceManifest: readonly SourceManifestEntry[] = [
  source({
    id: "openai-model-guidance",
    provider: "openai",
    title: "OpenAI GPT-5.6 prompt guidance",
    url: "https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6.md",
    documentKind: "prompting_guide",
    contentHash:
      "c074d3d8b539b0f2068040a24df1f95022afd83ee88e2936c7806e8720edd5f0",
    summary:
      "Current GPT-5.6 guidance for lean prompts, explicit autonomy boundaries, reasoning controls, tools, and evaluation.",
    expectedSignals: ["GPT-5.6", "reasoning effort", "prompt"],
  }),
  source({
    id: "anthropic-prompting-best-practices",
    provider: "anthropic",
    title: "Anthropic prompting best practices",
    url: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md",
    documentKind: "prompting_guide",
    contentHash:
      "f5813523ecf28fa173dedf2328c2d690d2e57654ec5001d8266168d2d6ef183f",
    summary:
      "Claude prompting guidance covering clarity, examples, XML structure, thinking, long context, tools, and agentic systems.",
    expectedSignals: ["Prompting best practices", "XML", "Claude"],
  }),
  source({
    id: "google-gemini-prompting",
    provider: "google",
    title: "Gemini prompt design strategies",
    url: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
    documentKind: "prompting_guide",
    contentHash:
      "c6ec9cc788837232a099095be13fcfe67c02c5db860fd7fd4b052156fb4e9238",
    driftStrategy: "required_signals",
    summary:
      "Gemini guidance for clear instructions, structured outputs, few-shot examples, long context, and keeping default sampling parameters for Gemini 3.x.",
    expectedSignals: [
      "Clear and specific instructions",
      "structured output",
      "Gemini 3.x models",
    ],
  }),
  source({
    id: "xai-models",
    provider: "xai",
    title: "Grok 4.5 model capabilities",
    url: "https://docs.x.ai/developers/models/grok-4.5.md",
    documentKind: "model_guide",
    contentHash:
      "7a40b91dbcd32621ec7d6ca24b2b65b8d84633fded872ff869a8c44caa4ca7b0",
    summary:
      "Official xAI Grok 4.5 guide documenting its exact model identity, 500,000-token context, image input, function calling, and structured outputs.",
    expectedSignals: [
      "Grok 4.5",
      "grok-4.5",
      "500,000 tokens",
      "Function calling",
      "Structured outputs",
    ],
  }),
  source({
    id: "xai-reasoning",
    provider: "xai",
    title: "xAI reasoning capabilities",
    url: "https://docs.x.ai/developers/model-capabilities/text/reasoning.md",
    documentKind: "model_guide",
    contentHash:
      "32a4a51568c7560e6fffde9b07c3378d458e0c028b02ea130d0b349035553fd5",
    summary:
      "Stable official xAI reasoning guide for Grok 4.5 effort levels, default behavior, encrypted state, and incompatible parameters.",
    expectedSignals: [
      "grok-4.5",
      "reasoning_effort",
      "Reasoning cannot be disabled",
      "presencePenalty",
    ],
  }),
  source({
    id: "deepseek-api-docs",
    provider: "deepseek",
    title: "DeepSeek API documentation",
    url: "https://api-docs.deepseek.com/",
    documentKind: "api_reference",
    contentHash:
      "d2f1f6f3f4b67d764db0896375764266ceb24f953b775fae9c8fadc3ca3f83c7",
    summary:
      "DeepSeek API entry point for chat and reasoner models, OpenAI-compatible transport, context, tools, and JSON output.",
    expectedSignals: ["DeepSeek", "API", "chat"],
  }),
  source({
    id: "meta-llama-models",
    provider: "meta",
    title: "Meta Llama model utilities and chat formats",
    url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/README.md",
    documentKind: "repository",
    contentHash:
      "0ac5f064caca753d78aa286ca382cf7e819b54b1f90edca9a905786b2aac238e",
    summary:
      "Official Meta repository for Llama model metadata, download tooling, safety utilities, and prompt-format implementation references.",
    expectedSignals: ["Llama", "models", "Meta"],
  }),
  source({
    id: "mistral-prompting",
    provider: "mistral",
    title: "Mistral prompting guide",
    url: "https://docs.mistral.ai/studio-api/conversations/chat-completion/prompting.md",
    documentKind: "prompting_guide",
    contentHash:
      "d2b1f1bd76f1ff528f2d60bd774c283be3309f454516433515fe1c493f7da5e4",
    summary:
      "Canonical markdown guide for Mistral system and user instructions, structured output, few-shot examples, contradiction avoidance, and concise output.",
    expectedSignals: [
      "System Prompt",
      "Structured Outputs",
      "Avoid Contradictions",
      "Do Not Generate Too Many Tokens",
    ],
  }),
  source({
    id: "kimi-overview",
    provider: "kimi",
    title: "Kimi API quickstart and model overview",
    url: "https://platform.kimi.ai/docs/overview",
    documentKind: "model_guide",
    contentHash:
      "cae2962dcc3f13faab63effddd64a7a1eb4249aad700c693627a505bfc71d4ce",
    summary:
      "Hosted Kimi API overview covering model selection, multimodal input, tools, JSON mode, context, and OpenAI-format compatibility.",
    expectedSignals: ["Kimi K3", "Kimi K2.7 Code", "Kimi K2.6"],
  }),
  source({
    id: "kimi-chat-api",
    provider: "kimi",
    title: "Kimi chat completion API",
    url: "https://platform.kimi.ai/docs/api/chat",
    documentKind: "api_reference",
    contentHash:
      "276b173368d53dc692fdb4c89024fc4981d3e80474cb47659f2cef3ed4f0222c",
    summary:
      "Kimi hosted Chat Completions contract for messages, tools, strict function schemas, reasoning content, and usage.",
    expectedSignals: ["Create Chat Completion", "tool_calls", "reasoning_content"],
  }),
  source({
    id: "kimi-prompting",
    provider: "kimi",
    title: "Kimi prompt best practices",
    url: "https://platform.kimi.ai/docs/guide/prompt-best-practice",
    documentKind: "prompting_guide",
    contentHash:
      "d42267d4ec2440a6b00c540669e8a7d3993e02c73341657e56424e17c3d9cfbb",
    summary:
      "Kimi guidance for clear detailed instructions, system roles, delimiters, explicit workflows, examples, and output constraints.",
    expectedSignals: ["Best Practices for Prompts", "Clear Instructions", "Delimiters"],
  }),
  source({
    id: "kimi-k3-guide",
    provider: "kimi",
    title: "Kimi K3 model guide",
    url: "https://platform.kimi.ai/docs/guide/kimi-k3-quickstart",
    documentKind: "model_guide",
    contentHash:
      "ee9da204a41bc62d3c7620ed2be99a0e39379de460b68da6b717b5210082cfc2",
    summary:
      "Kimi K3 hosted capabilities including 1M context, always-on reasoning, strict structured output, dynamic tools, and fixed sampling.",
    expectedSignals: ["Kimi K3", "Reasoning effort", "1M context"],
  }),
  source({
    id: "kimi-k2-7-code-guide",
    provider: "kimi",
    title: "Kimi K2.7 Code model guide",
    url: "https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart",
    documentKind: "model_guide",
    contentHash:
      "d5a085551c64edeede1a77f82d797ea5df706c51b29e5ddf056503be656e5c75",
    summary:
      "Kimi K2.7 Code hosted capabilities for long-horizon coding, 256K context, multimodality, thinking, and multi-step tools.",
    expectedSignals: ["Kimi K2.7 Code", "256K", "thinking"],
  }),
  source({
    id: "kimi-k2-6-guide",
    provider: "kimi",
    title: "Kimi K2.6 model guide",
    url: "https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart",
    documentKind: "model_guide",
    contentHash:
      "15879eac8b01ccf6023487f8e335e14f574479f16ded698c224c7f1f995ae6a4",
    summary:
      "Kimi K2.6 hosted capabilities for 256K multimodal context, thinking and instant modes, caching, structured output, and tools.",
    expectedSignals: ["Kimi K2.6", "256K", "thinking"],
  }),
  source({
    id: "kimi-code-repository",
    provider: "kimi",
    title: "Kimi Code CLI repository",
    url: "https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/README.md",
    documentKind: "repository",
    contentHash:
      "dc8992517be50091b4119410bd31bc53c1cb93e2b905868698ce98ec613b36a7",
    summary:
      "Official Moonshot repository describing the evolving Kimi terminal coding agent, local operations, authentication, and integrations.",
    expectedSignals: ["Kimi CLI", "terminal", "agent"],
  }),
  source({
    id: "hermes-agent-repository",
    provider: "hermes",
    title: "Hermes Agent repository",
    url: "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md",
    documentKind: "repository",
    contentHash:
      "56f261fc97cdd541407d16cf723c531ce89d48560fc675f7ed9754f6331177d9",
    summary:
      "Official Nous Research repository documenting Hermes Agent as a local agent surface with tools, skills, memory, and provider routing.",
    expectedSignals: ["Hermes Agent", "tools", "skills"],
  }),
];

const sourceById = new Map(sourceManifest.map((entry) => [entry.id, entry]));

export function getKnowledgeSource(id: string): SourceManifestEntry {
  const entry = sourceById.get(id);
  if (entry === undefined) {
    throw new Error(`Unknown knowledge source: ${id}`);
  }
  return entry;
}

export function sourceHash(id: string): string {
  return getKnowledgeSource(id).contentHash;
}

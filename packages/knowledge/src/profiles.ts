import {
  KnowledgeTargetProfileSchema,
  type KnowledgeTargetProfile,
  type TargetProfileFilter,
} from "./schemas.js";

function profile(value: KnowledgeTargetProfile): KnowledgeTargetProfile {
  return KnowledgeTargetProfileSchema.parse(value);
}

const fixedKimiSampling = [
  {
    name: "temperature",
    allowedValues: [1],
    fixedValue: 1,
    omitWhenFixed: true,
    notes: "The hosted model fixes temperature; omit it from requests.",
  },
  {
    name: "top_p",
    allowedValues: [0.95],
    fixedValue: 0.95,
    omitWhenFixed: true,
    notes: "The hosted model fixes top_p; omit it from requests.",
  },
  {
    name: "n",
    allowedValues: [1],
    fixedValue: 1,
    omitWhenFixed: true,
    notes: "Only one completion is supported.",
  },
] satisfies KnowledgeTargetProfile["parameterRules"];

const noParameterRules: KnowledgeTargetProfile["parameterRules"] = [];

export const targetProfiles: readonly KnowledgeTargetProfile[] = [
  profile({
    id: "openai-gpt-5.6-api",
    provider: "openai",
    model: "gpt-5.6",
    surface: "api",
    endpoint: "https://api.openai.com/v1/responses",
    roles: ["system", "developer", "user", "assistant", "tool"],
    reasoning: {
      modes: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultMode: "medium",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 1_050_000,
    forbiddenCombinations: [
      "Do not request hidden chain-of-thought.",
      "Programmatic tool calling must not perform approval-gated actions.",
    ],
    sourceIds: ["openai-model-guidance"],
    deployment: {
      host: "OpenAI",
      variant: "Responses API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "responses",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve response state through the Responses API continuation contract; never reconstruct hidden reasoning text.",
    serialization:
      "Use native Responses API input items and tool calls, not Chat Completions control tokens.",
    notes: [
      "Keep prompts lean and state each policy once.",
      "Exact model snapshots should be pinned by the caller when reproducibility is required.",
    ],
  }),
  profile({
    id: "openai-gpt-5.6-chatgpt",
    provider: "openai",
    model: "gpt-5.6",
    surface: "chat_app",
    endpoint: "surface://chatgpt",
    roles: ["user"],
    reasoning: {
      modes: ["surface_managed"],
      defaultMode: "surface_managed",
      preserveState: true,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: true,
      video: false,
      promptCaching: false,
    },
    contextWindow: 1_050_000,
    forbiddenCombinations: [
      "Do not emit API-only parameters into a paste-ready ChatGPT prompt.",
    ],
    sourceIds: ["openai-model-guidance"],
    deployment: {
      host: "ChatGPT",
      variant: "paste-ready prompt",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Rely on the active conversation context and restate only critical portable constraints.",
    serialization: "Render one user-facing prompt without API request fields.",
    notes: ["Surface capabilities may vary by account and enabled tools."],
  }),
  profile({
    id: "openai-gpt-5.6-codex",
    provider: "openai",
    model: "gpt-5.6",
    surface: "coding_cli",
    endpoint: "surface://codex",
    roles: ["developer", "user"],
    reasoning: {
      modes: ["low", "medium", "high", "xhigh"],
      defaultMode: "medium",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 1_050_000,
    forbiddenCombinations: [
      "Repository instructions must not silently broaden permissions.",
    ],
    sourceIds: ["openai-model-guidance"],
    deployment: {
      host: "Codex",
      variant: "repository instructions",
      mode: "local_target",
    },
    availability: "active",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["surface_managed"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve task state through the Codex task and repository artifacts.",
    serialization:
      "Render AGENTS.md-compatible instructions and task prompts without raw protocol tokens.",
    notes: ["Tool availability is discovered from the current Codex environment."],
  }),
  profile({
    id: "anthropic-claude-sonnet-5-api",
    provider: "anthropic",
    model: "claude-sonnet-5",
    surface: "api",
    endpoint: "https://api.anthropic.com/v1/messages",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["disabled", "adaptive"],
      defaultMode: "adaptive",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 1_000_000,
    forbiddenCombinations: [
      "The system instruction is a top-level field, not a messages role.",
      "Do not prefill unsupported reasoning or hidden thinking.",
    ],
    sourceIds: ["anthropic-prompting-best-practices"],
    deployment: {
      host: "Anthropic",
      variant: "Messages API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "messages",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "any", "tool", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Return complete assistant and tool-use blocks in later turns; preserve native block ordering.",
    serialization:
      "Map semantic system guidance to the top-level system field and use native content blocks.",
    notes: ["Use XML tags when they materially clarify prompt structure."],
  }),
  profile({
    id: "anthropic-claude-sonnet-5-chat",
    provider: "anthropic",
    model: "claude-sonnet-5",
    surface: "chat_app",
    endpoint: "surface://claude",
    roles: ["user"],
    reasoning: {
      modes: ["surface_managed"],
      defaultMode: "surface_managed",
      preserveState: true,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: true,
      video: false,
      promptCaching: false,
    },
    contextWindow: 1_000_000,
    forbiddenCombinations: [
      "Do not include Anthropic API fields in paste-ready content.",
    ],
    sourceIds: ["anthropic-prompting-best-practices"],
    deployment: {
      host: "Claude",
      variant: "paste-ready prompt",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy: "Use the active Claude conversation context.",
    serialization: "Render one user-facing prompt with clear XML sections.",
    notes: ["Surface features are account-dependent."],
  }),
  profile({
    id: "anthropic-claude-code-sonnet-5",
    provider: "anthropic",
    model: "claude-sonnet-5",
    surface: "coding_cli",
    endpoint: "surface://claude-code",
    roles: ["system", "user"],
    reasoning: {
      modes: ["surface_managed"],
      defaultMode: "surface_managed",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 1_000_000,
    forbiddenCombinations: [
      "Generated instructions must not enable tools or permissions implicitly.",
    ],
    sourceIds: ["anthropic-prompting-best-practices"],
    deployment: {
      host: "Claude Code",
      variant: "repository instructions",
      mode: "local_target",
    },
    availability: "active",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["surface_managed"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve work through the CLI session and explicit repository artifacts.",
    serialization:
      "Render Claude Code instructions without Messages API protocol fields.",
    notes: ["Runtime compilation requires a separately verified safe CLI adapter."],
  }),
  profile({
    id: "google-gemini-3.1-pro-api",
    provider: "google",
    model: "gemini-3.1-pro",
    surface: "api",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["low", "medium", "high"],
      defaultMode: "high",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: true,
      promptCaching: true,
    },
    contextWindow: 1_048_576,
    forbiddenCombinations: [
      "Thought signatures must remain attached to their native parts.",
      "OpenAI-compatible transport does not imply OpenAI role semantics.",
    ],
    sourceIds: ["google-gemini-prompting"],
    deployment: {
      host: "Google AI",
      variant: "Gemini API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "generate_content",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "any", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve native content parts and thought signatures across tool turns.",
    serialization:
      "Use systemInstruction and Gemini content parts; do not serialize OpenAI message objects.",
    notes: [
      "Put long context before the final specific instruction.",
      "Keep Gemini 3.x sampling parameters at their defaults unless target-specific evaluation proves an override.",
    ],
  }),
  profile({
    id: "xai-grok-4.5-api",
    provider: "xai",
    model: "grok-4.5",
    surface: "api",
    endpoint: "https://api.x.ai/v1/responses",
    roles: ["system", "developer", "user", "assistant", "tool"],
    reasoning: {
      modes: ["low", "medium", "high"],
      defaultMode: "high",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 500_000,
    forbiddenCombinations: [
      "Reasoning cannot be disabled.",
      "Do not send presencePenalty, frequencyPenalty, or stop with this reasoning model.",
    ],
    sourceIds: ["xai-models", "xai-reasoning"],
    deployment: {
      host: "xAI",
      variant: "Responses API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "responses",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve response and tool state using xAI-native response identifiers.",
    serialization:
      "Use the documented xAI endpoint and exact Grok model identity.",
    notes: ["Compatibility is validated independently from OpenAI."],
  }),
  profile({
    id: "deepseek-chat-api",
    provider: "deepseek",
    model: "deepseek-chat",
    surface: "api",
    endpoint: "https://api.deepseek.com/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["non-reasoning"],
      defaultMode: "non-reasoning",
      preserveState: false,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: false,
      video: false,
      promptCaching: true,
    },
    contextWindow: 128_000,
    forbiddenCombinations: [
      "Do not send image or video content.",
      "OpenAI-compatible transport does not guarantee OpenAI feature parity.",
    ],
    sourceIds: ["deepseek-api-docs"],
    deployment: {
      host: "DeepSeek",
      variant: "Chat Completions API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Replay the documented conversation and native tool messages; do not invent hidden state.",
    serialization:
      "Use DeepSeek's documented OpenAI-compatible subset and fail on unsupported fields.",
    notes: ["Use a separate reasoner profile when reasoning behavior is required."],
  }),
  profile({
    id: "deepseek-reasoner-api",
    provider: "deepseek",
    model: "deepseek-reasoner",
    surface: "api",
    endpoint: "https://api.deepseek.com/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["reasoning"],
      defaultMode: "reasoning",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: false,
      video: false,
      promptCaching: true,
    },
    contextWindow: 128_000,
    forbiddenCombinations: [
      "Do not ask for or replay hidden reasoning as user-visible content.",
      "Do not assume every deepseek-chat parameter is accepted by deepseek-reasoner.",
    ],
    sourceIds: ["deepseek-api-docs"],
    deployment: {
      host: "DeepSeek",
      variant: "Reasoner Chat Completions API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve the complete assistant response fields required by the current DeepSeek reasoning contract.",
    serialization:
      "Use DeepSeek reasoner fields and validate them independently from OpenAI.",
    notes: ["Return conclusions and evidence, not hidden chain-of-thought."],
  }),
  profile({
    id: "meta-llama-4-maverick-open-weights",
    provider: "meta",
    model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
    surface: "open_weights",
    endpoint: "self-hosted://llama-4-maverick",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["deployment_defined"],
      defaultMode: "deployment_defined",
      preserveState: false,
    },
    supports: {
      tools: true,
      structuredOutput: false,
      image: true,
      video: false,
      promptCaching: false,
    },
    contextWindow: 1_048_576,
    forbiddenCombinations: [
      "Do not place raw chat-template control tokens in the semantic blueprint.",
      "Tool and schema support require a deployment-specific capability probe.",
    ],
    sourceIds: ["meta-llama-models"],
    deployment: {
      host: "self-hosted",
      variant: "official Llama chat format",
      mode: "self_hosted",
    },
    availability: "active",
    apiStyle: "chat_template",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: ["deployment_defined"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Replay only messages supported by the selected inference server and tokenizer template.",
    serialization:
      "Delegate special tokens and chat templates to the deployment serializer.",
    notes: ["Hosted inference providers require their own derived profiles."],
  }),
  profile({
    id: "mistral-large-3-api",
    provider: "mistral",
    model: "mistral-large-3-25-12",
    surface: "api",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["standard"],
      defaultMode: "standard",
      preserveState: false,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: false,
      promptCaching: false,
    },
    contextWindow: 256_000,
    forbiddenCombinations: [
      "Do not emit raw Mistral control tokens into hosted API messages.",
    ],
    sourceIds: ["mistral-prompting"],
    deployment: {
      host: "Mistral AI",
      variant: "Chat Completions API",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "any", "none"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve native assistant tool calls and matching tool results.",
    serialization:
      "Use Mistral API roles; keep open-weight template tokens in a separate serializer.",
    notes: ["Exact dated model ID is used instead of a latest alias."],
  }),
  profile({
    id: "mistral-large-3-open-weights",
    provider: "mistral",
    model: "mistral-large-3-25-12",
    surface: "open_weights",
    endpoint: "self-hosted://mistral-large-3",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["deployment_defined"],
      defaultMode: "deployment_defined",
      preserveState: false,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: false,
      video: false,
      promptCaching: false,
    },
    contextWindow: 256_000,
    forbiddenCombinations: [
      "Tools, structured output, and multimodality stay disabled until the inference deployment passes a capability probe.",
    ],
    sourceIds: ["mistral-prompting"],
    deployment: {
      host: "self-hosted",
      variant: "deployment-specific chat template",
      mode: "self_hosted",
    },
    availability: "active",
    apiStyle: "chat_template",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Replay only deployment-supported messages after tokenizer-template validation.",
    serialization:
      "Keep special tokens entirely inside the deployment-specific serializer.",
    notes: ["Conservative defaults fail closed before a live deployment probe."],
  }),
  profile({
    id: "kimi-k3-api",
    provider: "kimi",
    model: "kimi-k3",
    surface: "api",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["low", "high", "max"],
      defaultMode: "max",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: true,
      promptCaching: true,
    },
    contextWindow: 1_048_576,
    forbiddenCombinations: [
      "Thinking cannot be disabled.",
      "Do not modify or discard the complete assistant message between tool turns.",
      "Public image URLs are unsupported.",
    ],
    sourceIds: [
      "kimi-overview",
      "kimi-chat-api",
      "kimi-prompting",
      "kimi-k3-guide",
    ],
    deployment: {
      host: "Moonshot AI",
      variant: "Kimi hosted Chat Completions",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: true,
      strictSchemas: true,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: [
      ...fixedKimiSampling,
      {
        name: "reasoning_effort",
        allowedValues: ["low", "high", "max"],
        fixedValue: null,
        omitWhenFixed: false,
        notes: "Top-level field; default is max.",
      },
    ],
    continuationPolicy:
      "Append the complete assistant message unchanged, including reasoning_content and tool calls, before matching tool results.",
    serialization:
      "Use Kimi's documented OpenAI-format subset; retain Kimi-specific reasoning and partial fields.",
    notes: [
      "Context caching is automatic for eligible stable prefixes.",
      "Parse structured final output from message.content, never reasoning_content.",
    ],
  }),
  profile({
    id: "kimi-k2.7-code-api",
    provider: "kimi",
    model: "kimi-k2.7-code",
    surface: "api",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["thinking"],
      defaultMode: "thinking",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: true,
      promptCaching: true,
    },
    contextWindow: 262_144,
    forbiddenCombinations: [
      "Non-thinking mode is unsupported.",
      "Preserve the complete assistant message for multi-step tools.",
    ],
    sourceIds: [
      "kimi-overview",
      "kimi-chat-api",
      "kimi-prompting",
      "kimi-k2-7-code-guide",
    ],
    deployment: {
      host: "Moonshot AI",
      variant: "Kimi hosted coding model",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: true,
      strictSchemas: true,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: fixedKimiSampling,
    continuationPolicy:
      "Preserve native thinking and the complete assistant tool-call message across coding-agent turns.",
    serialization:
      "Use Kimi hosted fields and keep coding-agent instructions outcome-focused.",
    notes: ["The highspeed model is a separate deployable model ID."],
  }),
  profile({
    id: "kimi-k2.6-api",
    provider: "kimi",
    model: "kimi-k2.6",
    surface: "api",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    roles: ["system", "user", "assistant", "tool"],
    reasoning: {
      modes: ["thinking", "instant"],
      defaultMode: "thinking",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: true,
      image: true,
      video: true,
      promptCaching: true,
    },
    contextWindow: 262_144,
    forbiddenCombinations: [
      "Thinking-state messages must remain intact during multi-step tool use.",
    ],
    sourceIds: [
      "kimi-overview",
      "kimi-chat-api",
      "kimi-prompting",
      "kimi-k2-6-guide",
    ],
    deployment: {
      host: "Moonshot AI",
      variant: "Kimi hosted general model",
      mode: "hosted",
    },
    availability: "active",
    apiStyle: "openai_compatible",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: true,
      toolChoiceModes: ["auto", "required", "none"],
    },
    parameterRules: fixedKimiSampling,
    continuationPolicy:
      "Preserve native assistant reasoning and tool messages when continuing a multi-step workflow.",
    serialization:
      "Select thinking or instant mode using Kimi's model-specific request contract.",
    notes: ["Hosted caching and multimodal behavior are not inherited by self-hosted deployments."],
  }),
  profile({
    id: "kimi-k3-self-hosted",
    provider: "kimi",
    model: "kimi-k3",
    surface: "open_weights",
    endpoint: "self-hosted://kimi-k3",
    roles: ["system", "user", "assistant"],
    reasoning: {
      modes: ["thinking"],
      defaultMode: "thinking",
      preserveState: false,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: false,
      video: false,
      promptCaching: false,
    },
    contextWindow: 1_048_576,
    forbiddenCombinations: [
      "Hosted tool parsing, strict schemas, caching, and multimodality are disabled until independently probed.",
      "Do not copy hosted API guarantees into a self-hosted profile.",
    ],
    sourceIds: ["kimi-overview", "kimi-prompting", "kimi-k3-guide"],
    deployment: {
      host: "self-hosted",
      variant: "deployment-specific Kimi K3",
      mode: "self_hosted",
    },
    availability: "target_only",
    apiStyle: "chat_template",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Use only state fields proven by the selected inference server.",
    serialization:
      "Resolve tokenizer and chat-template control tokens in the deployment adapter.",
    notes: ["Conservative fail-closed profile pending deployment conformance."],
  }),
  profile({
    id: "kimi-k2.7-code-self-hosted",
    provider: "kimi",
    model: "kimi-k2.7-code",
    surface: "open_weights",
    endpoint: "self-hosted://kimi-k2.7-code",
    roles: ["system", "user", "assistant"],
    reasoning: {
      modes: ["thinking"],
      defaultMode: "thinking",
      preserveState: false,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: false,
      video: false,
      promptCaching: false,
    },
    contextWindow: 262_144,
    forbiddenCombinations: [
      "Hosted coding-agent tool behavior is disabled until independently probed.",
    ],
    sourceIds: [
      "kimi-overview",
      "kimi-prompting",
      "kimi-k2-7-code-guide",
    ],
    deployment: {
      host: "self-hosted",
      variant: "deployment-specific Kimi K2.7 Code",
      mode: "self_hosted",
    },
    availability: "target_only",
    apiStyle: "chat_template",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Use only state and tool messages proven by the inference server.",
    serialization:
      "Resolve coding chat-template tokens in the deployment adapter.",
    notes: ["Conservative fail-closed profile pending deployment conformance."],
  }),
  profile({
    id: "kimi-k2.6-self-hosted",
    provider: "kimi",
    model: "kimi-k2.6",
    surface: "open_weights",
    endpoint: "self-hosted://kimi-k2.6",
    roles: ["system", "user", "assistant"],
    reasoning: {
      modes: ["thinking", "instant"],
      defaultMode: "thinking",
      preserveState: false,
    },
    supports: {
      tools: false,
      structuredOutput: false,
      image: false,
      video: false,
      promptCaching: false,
    },
    contextWindow: 262_144,
    forbiddenCombinations: [
      "Hosted multimodal, schema, tool, and cache guarantees are disabled until independently probed.",
    ],
    sourceIds: ["kimi-overview", "kimi-prompting", "kimi-k2-6-guide"],
    deployment: {
      host: "self-hosted",
      variant: "deployment-specific Kimi K2.6",
      mode: "self_hosted",
    },
    availability: "target_only",
    apiStyle: "chat_template",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: [],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Use only thinking state and tool fields proven by the inference server.",
    serialization:
      "Resolve Kimi chat-template tokens in the deployment adapter.",
    notes: ["Conservative fail-closed profile pending deployment conformance."],
  }),
  profile({
    id: "kimi-code-cli",
    provider: "kimi",
    model: "kimi-k2.7-code",
    surface: "coding_cli",
    endpoint: "surface://kimi-code",
    roles: ["system", "user"],
    reasoning: {
      modes: ["surface_managed"],
      defaultMode: "surface_managed",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: false,
      image: true,
      video: false,
      promptCaching: true,
    },
    contextWindow: 262_144,
    forbiddenCombinations: [
      "Do not use Kimi Code as a compiler backend until doctor verifies installation, authentication, isolation, and a safe invocation.",
    ],
    sourceIds: [
      "kimi-prompting",
      "kimi-code-repository",
      "kimi-k2-7-code-guide",
    ],
    deployment: {
      host: "Kimi Code",
      variant: "repository agent assets",
      mode: "local_target",
    },
    availability: "target_only",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: true,
      dynamicLoading: false,
      strictSchemas: false,
      toolChoiceModes: ["surface_managed"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Preserve session state only through documented Kimi Code mechanisms.",
    serialization:
      "Render Kimi Code repository instructions and skills without hosted API fields.",
    notes: ["Target-only until a safe local conformance probe succeeds."],
  }),
  profile({
    id: "hermes-agent",
    provider: "hermes",
    model: "provider-selected",
    surface: "agent_cli",
    endpoint: "surface://hermes-agent",
    roles: ["system", "user"],
    reasoning: {
      modes: ["provider_managed"],
      defaultMode: "provider_managed",
      preserveState: true,
    },
    supports: {
      tools: true,
      structuredOutput: false,
      image: false,
      video: false,
      promptCaching: false,
    },
    contextWindow: 131_072,
    forbiddenCombinations: [
      "Do not use Hermes as an evaluator or compiler backend without a proven zero-tools safe mode.",
      "Do not launch generated agents automatically.",
    ],
    sourceIds: ["hermes-agent-repository"],
    deployment: {
      host: "Hermes Agent",
      variant: "agent package assets",
      mode: "local_target",
    },
    availability: "target_only",
    apiStyle: "surface_asset",
    toolCapabilities: {
      parallel: false,
      dynamicLoading: true,
      strictSchemas: false,
      toolChoiceModes: ["surface_managed"],
    },
    parameterRules: noParameterRules,
    continuationPolicy:
      "Use only documented Hermes memory and session artifacts; never assume provider reasoning-state portability.",
    serialization:
      "Render Hermes skills, tool manifests, and agent instructions; keep provider protocol separate.",
    notes: ["Context limit is a conservative compilation ceiling until the selected provider is known."],
  }),
];

const profileById = new Map(targetProfiles.map((entry) => [entry.id, entry]));

export class UnknownTargetProfileError extends Error {
  readonly profileId: string;

  constructor(profileId: string) {
    super(`Unknown target profile: ${profileId}`);
    this.name = "UnknownTargetProfileError";
    this.profileId = profileId;
  }
}

export function getTargetProfile(id: string): KnowledgeTargetProfile {
  const entry = profileById.get(id);
  if (entry === undefined) {
    throw new UnknownTargetProfileError(id);
  }
  return entry;
}

export function listTargetProfiles(
  filter: TargetProfileFilter = {},
): KnowledgeTargetProfile[] {
  return targetProfiles.filter((entry) => {
    return (
      (filter.provider === undefined || entry.provider === filter.provider) &&
      (filter.surface === undefined || entry.surface === filter.surface) &&
      (filter.availability === undefined ||
        entry.availability === filter.availability) &&
      (filter.deploymentMode === undefined ||
        entry.deployment.mode === filter.deploymentMode)
    );
  });
}

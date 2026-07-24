import { z } from "zod";

export const ContractVersionSchema = z.literal("1.0.0");
export const VerificationStatusSchema = z.enum([
  "compiled",
  "statically_validated",
  "proxy_evaluated",
  "target_evaluated",
  "human_approved",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const JsonSchemaSchema = z.record(z.string(), z.unknown()).superRefine((schema, context) => {
  const hasRootKeyword = ["type", "$ref", "anyOf", "oneOf", "allOf"].some(
    (keyword) => Object.hasOwn(schema, keyword),
  );
  if (!hasRootKeyword) {
    context.addIssue({
      code: "custom",
      message: "A JSON Schema must declare a root type, reference, or composition keyword.",
    });
  }
});

export const ProvenanceSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  trust: z.enum(["trusted_instruction", "user", "retrieved", "tool", "unknown"]),
  summary: z.string().min(1),
});

export const IntentContractSchema = z.object({
  version: ContractVersionSchema,
  objective: z.string().min(1),
  motivation: z.string().default("Not specified"),
  audience: z.array(z.string().min(1)).min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  inputs: z.array(z.string().min(1)).default([]),
  context: z.array(ProvenanceSchema).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  preferences: z.array(z.string().min(1)).default([]),
  exclusions: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  evidenceRequirements: z.array(z.string().min(1)).default([]),
  outputContract: z.object({
    format: z.string().min(1),
    schema: JsonSchemaSchema.optional(),
    language: z.string().min(1),
    verbosity: z.enum(["concise", "balanced", "detailed"]),
  }),
  risk: z.enum(["low", "medium", "high", "critical"]),
  unresolvedAmbiguity: z.array(
    z.object({
      field: z.string().min(1),
      question: z.string().min(1),
      impact: z.enum(["blocking", "high", "safe"]),
      recommendedAssumption: z.string().min(1),
    }),
  ),
});
export type IntentContract = z.infer<typeof IntentContractSchema>;

export const TypedInputSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/),
  description: z.string().min(1),
  required: z.boolean(),
  schema: JsonSchemaSchema,
  provenance: z.enum(["user", "project", "retrieved", "tool"]),
});

/**
 * The durable, provider-neutral description of a prompt to be optimized.
 *
 * It intentionally describes what the human wants and how the answer should
 * be shaped. It is not an agent manifest: it contains no tools, permissions,
 * servers, memory, budgets, or action workflow. Those concepts belong to a
 * runtime, not to a paste-ready prompt.
 */
export const PromptSpecSchema = z.object({
  version: ContractVersionSchema,
  id: z.string().min(1),
  demand: IntentContractSchema,
  guidance: z.object({
    role: z.string().min(1),
    principles: z.array(z.string().min(1)).min(1),
    method: z.array(z.string().min(1)).min(1),
  }),
  inputBindings: z.array(TypedInputSchema).default([]),
  evaluation: z.object({
    criteria: z.array(z.string().min(1)).min(1),
    evidencePolicy: z.string().min(1),
    candidateDimensions: z.array(z.enum([
      "baseline",
      "verification_emphasis",
      "reasoning_structure",
    ])).min(1),
  }),
});
export type PromptSpec = z.infer<typeof PromptSpecSchema>;

export const TargetProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.enum([
    "openai",
    "anthropic",
    "google",
    "xai",
    "deepseek",
    "meta",
    "mistral",
    "kimi",
    "hermes",
  ]),
  model: z.string().min(1),
  surface: z.enum([
    "api",
    "chat_app",
    "coding_cli",
    "open_weights",
    "agent_cli",
  ]),
  endpoint: z.string().min(1),
  roles: z.array(z.enum(["system", "developer", "user", "assistant", "tool"])),
  reasoning: z.object({
    modes: z.array(z.string()),
    defaultMode: z.string(),
    preserveState: z.boolean(),
  }),
  supports: z.object({
    tools: z.boolean(),
    structuredOutput: z.boolean(),
    image: z.boolean(),
    video: z.boolean(),
    promptCaching: z.boolean(),
  }),
  contextWindow: z.number().int().positive(),
  forbiddenCombinations: z.array(z.string()),
  sourceIds: z.array(z.string().min(1)).min(1),
});
export type TargetProfile = z.infer<typeof TargetProfileSchema>;

export const KnowledgeRuleSchema = z.object({
  id: z.string().min(1),
  scope: z.object({
    provider: TargetProfileSchema.shape.provider,
    models: z.array(z.string()),
    surfaces: z.array(TargetProfileSchema.shape.surface),
  }),
  rule: z.string().min(1),
  sourceUrl: z.url(),
  sourceHash: z.string().min(1),
  verifiedAt: z.iso.datetime(),
  confidence: z.enum(["high", "medium", "conflicted"]),
  conflicts: z.array(z.string()),
  conformanceTest: z.string().min(1),
});
export type KnowledgeRule = z.infer<typeof KnowledgeRuleSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "nominal",
    "ambiguous",
    "edge",
    "multilingual",
    "adversarial",
    "should_not_act",
    "tool_failure",
    "long_context",
    "refusal",
    "output_schema",
  ]),
  input: z.string(),
  expectedProperties: z.array(z.string()).min(1),
  deterministicChecks: z.array(z.string()),
  rubric: z.array(z.string()).min(1),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const CompiledArtifactSchema = z.object({
  targetId: z.string().min(1),
  filename: z.string().min(1),
  content: z.string().min(1),
  mimeType: z.string().min(1),
  warnings: z.array(z.string()),
});

const NullableUnitScoreSchema = z.number().min(0).max(1).nullable().optional();

/**
 * Behavioral metrics are optional because static package validation cannot
 * observe most of them. Evaluators should populate only measurements they
 * actually observed instead of manufacturing zeroes.
 */
export const EvalMetricsSchema = z.object({
  intentPreservation: NullableUnitScoreSchema,
  completeness: NullableUnitScoreSchema,
  outputValidity: NullableUnitScoreSchema,
  evidence: NullableUnitScoreSchema,
  toolChoice: NullableUnitScoreSchema,
  permissionCompliance: NullableUnitScoreSchema,
  unsupportedSettings: NullableUnitScoreSchema,
  clarificationBurden: z.number().nonnegative().nullable().optional(),
  latencyMs: z.number().nonnegative().nullable().optional(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  cost: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).nullable().optional(),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

/**
 * Populated only by the core external-evaluation boundary. It identifies the
 * exact evidence run without making legacy/static results invalid.
 */
export const ExternalEvaluationProvenanceSchema = z.object({
  runId: z.string().uuid(),
  backendId: z.string().min(1),
  repetition: z.number().int().positive(),
  totalRepetitions: z.number().int().positive(),
  evaluatedAt: z.iso.datetime(),
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExternalEvaluationProvenance = z.infer<typeof ExternalEvaluationProvenanceSchema>;

export const EvalResultSchema = z.object({
  caseId: z.string().min(1),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  mode: z.enum(["static", "proxy", "live"]),
  targetId: z.string().min(1),
  durationMs: z.number().nonnegative(),
  metrics: EvalMetricsSchema.optional(),
  provenance: ExternalEvaluationProvenanceSchema.optional(),
});

export const PromptPackageSchema = z.object({
  version: ContractVersionSchema,
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  originalBrief: z.string().min(1),
  clarificationLineage: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      assumed: z.boolean(),
    }),
  ),
  prompt: PromptSpecSchema,
  artifacts: z.array(CompiledArtifactSchema),
  warnings: z.array(z.string()),
  evals: z.array(EvalCaseSchema),
  results: z.array(EvalResultSchema),
  knowledge: z.object({
    packVersion: z.string().min(1),
    ruleIds: z.array(z.string()),
    sourceVersions: z.record(z.string(), z.string().min(1)).default({}),
  }),
  verification: VerificationStatusSchema,
});
export type PromptPackage = z.infer<typeof PromptPackageSchema>;

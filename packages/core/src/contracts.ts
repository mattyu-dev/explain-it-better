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

export const ToolSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/),
  description: z.string().min(12),
  inputSchema: JsonSchemaSchema.refine((schema) => schema["type"] === "object", {
    message: "Tool input schemas must have an object root.",
  }),
  sideEffect: z.enum(["none", "read", "write", "external"]),
  requiresApproval: z.boolean(),
});

export const TypedInputSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/),
  description: z.string().min(1),
  required: z.boolean(),
  schema: JsonSchemaSchema,
  provenance: z.enum(["user", "project", "retrieved", "tool"]),
});

const McpIdentifierSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/);

/**
 * Declarative MCP configuration only. EIB persists this contract but never
 * launches a server, resolves an endpoint, or forwards credentials from it.
 *
 * `stdio` endpoints are executable names, not shell snippets. A future
 * runtime must invoke them without a shell and supply any arguments through a
 * separately reviewed execution contract. `http` endpoints are HTTPS URLs
 * without embedded credentials or fragments.
 */
const McpStdioServerSpecSchema = z.object({
  name: McpIdentifierSchema,
  transport: z.literal("stdio"),
  endpoint: McpIdentifierSchema,
  allowedTools: z.array(McpIdentifierSchema).min(1).superRefine((tools, context) => {
    if (new Set(tools).size !== tools.length) {
      context.addIssue({ code: "custom", message: "MCP allowedTools must not contain duplicates." });
    }
  }),
  trust: z.enum(["trusted", "untrusted"]),
  requiresApproval: z.boolean(),
}).strict();

const McpHttpServerSpecSchema = z.object({
  name: McpIdentifierSchema,
  transport: z.literal("http"),
  endpoint: z.url().superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "HTTP MCP endpoints must use HTTPS." });
    }
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "HTTP MCP endpoints must not include credentials; configure credentials in the target runtime.",
      });
    }
    if (url.hash) {
      context.addIssue({ code: "custom", message: "HTTP MCP endpoints must not include a fragment." });
    }
  }),
  allowedTools: z.array(McpIdentifierSchema).min(1).superRefine((tools, context) => {
    if (new Set(tools).size !== tools.length) {
      context.addIssue({ code: "custom", message: "MCP allowedTools must not contain duplicates." });
    }
  }),
  trust: z.enum(["trusted", "untrusted"]),
  requiresApproval: z.boolean(),
}).strict();

export const McpServerSpecSchema = z
  .discriminatedUnion("transport", [McpStdioServerSpecSchema, McpHttpServerSpecSchema])
  .superRefine((server, context) => {
    if (server.trust === "untrusted" && !server.requiresApproval) {
      context.addIssue({
        code: "custom",
        message: "Untrusted MCP servers must require approval before use.",
      });
    }
  });
export type McpServerSpec = z.infer<typeof McpServerSpecSchema>;

export const McpServerSpecsSchema = z.array(McpServerSpecSchema).superRefine((servers, context) => {
  const names = new Set<string>();
  for (const [index, server] of servers.entries()) {
    if (names.has(server.name)) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: `MCP server name ${JSON.stringify(server.name)} must be unique.`,
      });
    }
    names.add(server.name);
  }
});

export const AgentBlueprintSchema = z.object({
  version: ContractVersionSchema,
  id: z.string().min(1),
  intent: IntentContractSchema,
  roles: z.object({
    identity: z.string().min(1),
    policy: z.array(z.string().min(1)),
  }),
  workflow: z.array(
    z.object({
      id: z.string().min(1),
      instruction: z.string().min(1),
      dependsOn: z.array(z.string()).default([]),
      verification: z.string().min(1),
    }),
  ).min(1),
  subagents: z.array(
    z.object({
      name: z.string().min(1),
      purpose: z.string().min(1),
      allowedTools: z.array(z.string()),
      completionContract: z.string().min(1),
    }),
  ).default([]),
  tools: z.array(ToolSpecSchema).default([]),
  mcpServers: McpServerSpecsSchema.default([]),
  typedInputs: z.array(TypedInputSchema).default([]),
  memory: z.object({
    enabled: z.boolean(),
    scope: z.enum(["none", "task", "project", "user"]),
    retention: z.string().min(1),
    writePolicy: z.string().min(1),
  }),
  permissions: z.object({
    filesystem: z.enum(["none", "read_only", "workspace_write"]),
    network: z.enum(["none", "read_only", "full"]),
    externalActions: z.enum(["forbidden", "approval_required"]),
  }),
  approvals: z.object({
    requiredFor: z.array(z.enum(["filesystem_write", "network_write", "external_action"])),
    approver: z.literal("human"),
    recordPolicy: z.string().min(1),
  }),
  budgets: z.object({
    maxTurns: z.number().int().positive(),
    maxMinutes: z.number().int().positive(),
    tokenGuidance: z.number().int().positive(),
  }),
  verification: z.object({
    criteria: z.array(z.string().min(1)).min(1),
    evidencePolicy: z.string().min(1),
    independentReview: z.boolean(),
  }),
  stoppingRules: z.array(z.string().min(1)).min(1),
  failureHandling: z.array(z.string().min(1)).min(1),
});
export type AgentBlueprint = z.infer<typeof AgentBlueprintSchema>;

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

/**
 * A human's explicit review of a concrete package revision. The hash is of
 * the package immediately before this record was appended, so later edits do
 * not silently change what the person approved.
 */
export const HumanApprovalRecordSchema = z.object({
  id: z.string().uuid(),
  approvedAt: z.iso.datetime(),
  approver: z.literal("human"),
  statement: z.string().trim().min(1).max(4_000),
  approvedPackageHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvalRequirements: z.array(
    z.enum(["filesystem_write", "network_write", "external_action"]),
  ),
});
export type HumanApprovalRecord = z.infer<typeof HumanApprovalRecordSchema>;

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
  blueprint: AgentBlueprintSchema,
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
  approvalRecords: z.array(HumanApprovalRecordSchema).default([]),
});
export type PromptPackage = z.infer<typeof PromptPackageSchema>;

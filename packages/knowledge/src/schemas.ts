import {
  KnowledgeRuleSchema,
  TargetProfileSchema,
} from "@eib/core";
import { z } from "zod";

export const KNOWLEDGE_PACK_VERSION = "2026.07.24-v4";

export const SourceManifestEntrySchema = z.object({
  id: z.string().min(1),
  provider: TargetProfileSchema.shape.provider,
  title: z.string().min(1),
  url: z.url(),
  documentKind: z.enum([
    "prompting_guide",
    "model_guide",
    "api_reference",
    "repository",
  ]),
  reviewStatus: z.literal("reviewed"),
  reviewedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  driftStrategy: z.enum(["full_hash", "required_signals"]),
  summary: z.string().min(24),
  expectedSignals: z.array(z.string().min(2)).min(1),
});
export type SourceManifestEntry = z.infer<typeof SourceManifestEntrySchema>;

export const ParameterRuleSchema = z.object({
  name: z.string().min(1),
  allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])),
  fixedValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  omitWhenFixed: z.boolean(),
  notes: z.string(),
});
export type ParameterRule = z.infer<typeof ParameterRuleSchema>;

export const KnowledgeTargetProfileSchema = TargetProfileSchema.extend({
  deployment: z.object({
    host: z.string().min(1),
    variant: z.string().min(1),
    mode: z.enum(["hosted", "self_hosted", "local_target"]),
  }),
  availability: z.enum(["active", "target_only"]),
  apiStyle: z.enum([
    "responses",
    "messages",
    "generate_content",
    "openai_compatible",
    "chat_template",
    "surface_asset",
  ]),
  toolCapabilities: z.object({
    parallel: z.boolean(),
    dynamicLoading: z.boolean(),
    strictSchemas: z.boolean(),
    toolChoiceModes: z.array(z.string()),
  }),
  parameterRules: z.array(ParameterRuleSchema),
  continuationPolicy: z.string().min(1),
  serialization: z.string().min(1),
  notes: z.array(z.string()),
});
export type KnowledgeTargetProfile = z.infer<
  typeof KnowledgeTargetProfileSchema
>;

export const TargetConfigurationSchema = z.object({
  roles: z
    .array(z.enum(["system", "developer", "user", "assistant", "tool"]))
    .default([]),
  reasoningMode: z.string().nullable().default(null),
  tools: z.boolean().default(false),
  structuredOutput: z.boolean().default(false),
  image: z.boolean().default(false),
  video: z.boolean().default(false),
  promptCaching: z.boolean().default(false),
  contextTokens: z.number().int().nonnegative().default(0),
  toolChoiceMode: z.string().nullable().default(null),
  dynamicTools: z.boolean().default(false),
  strictToolSchemas: z.boolean().default(false),
  parameters: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ).default({}),
}).strict();
export type TargetConfiguration = z.infer<typeof TargetConfigurationSchema>;

export const ConformanceIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  path: z.string().min(1),
  message: z.string().min(1),
});
export type ConformanceIssue = z.infer<typeof ConformanceIssueSchema>;

export const ConformanceReportSchema = z.object({
  valid: z.boolean(),
  profileId: z.string().min(1),
  issues: z.array(ConformanceIssueSchema),
});
export type ConformanceReport = z.infer<typeof ConformanceReportSchema>;

export const KnowledgePackInputSchema = z.object({
  version: z.string().min(1),
  sources: z.array(SourceManifestEntrySchema),
  profiles: z.array(KnowledgeTargetProfileSchema),
  rules: z.array(KnowledgeRuleSchema),
});
export type KnowledgePackInput = z.infer<typeof KnowledgePackInputSchema>;

export const KnowledgePackValidationReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  counts: z.object({
    sources: z.number().int().nonnegative(),
    profiles: z.number().int().nonnegative(),
    rules: z.number().int().nonnegative(),
  }),
});
export type KnowledgePackValidationReport = z.infer<
  typeof KnowledgePackValidationReportSchema
>;

export const RuleConformanceResultSchema = z.object({
  ruleId: z.string().min(1),
  profileId: z.string().min(1),
  passed: z.boolean(),
  evidence: z.array(z.string().min(1)),
  failures: z.array(z.string().min(1)),
});
export type RuleConformanceResult = z.infer<
  typeof RuleConformanceResultSchema
>;

export const KnowledgeRuleConformanceReportSchema = z.object({
  valid: z.boolean(),
  results: z.array(RuleConformanceResultSchema),
  missingHandlerRuleIds: z.array(z.string().min(1)),
  unappliedRuleIds: z.array(z.string().min(1)),
});
export type KnowledgeRuleConformanceReport = z.infer<
  typeof KnowledgeRuleConformanceReportSchema
>;

export const KnowledgeSourceCheckSchema = z.object({
  sourceId: z.string().min(1),
  url: z.url(),
  status: z.enum(["current", "changed", "unreachable"]),
  driftStrategy: SourceManifestEntrySchema.shape.driftStrategy,
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  hashMatches: z.boolean().nullable(),
  signalsMatch: z.boolean().nullable(),
  decisionBasis: z.enum([
    "full_hash_and_signals",
    "required_signals",
    "unreachable",
  ]),
  httpStatus: z.number().int().nonnegative().nullable(),
  missingSignals: z.array(z.string()),
  error: z.string().nullable(),
});
export type KnowledgeSourceCheck = z.infer<typeof KnowledgeSourceCheckSchema>;

export const KnowledgeCheckReportSchema = z.object({
  packVersion: z.string().min(1),
  checkedAt: z.iso.datetime(),
  status: z.enum(["current", "drift_detected", "incomplete"]),
  checks: z.array(KnowledgeSourceCheckSchema),
});
export type KnowledgeCheckReport = z.infer<typeof KnowledgeCheckReportSchema>;

export const KnowledgeStageSchema = z.object({
  packVersion: z.string().min(1),
  stagedAt: z.iso.datetime(),
  activation: z.literal("blocked_pending_review"),
  changes: z.array(
    z.object({
      sourceId: z.string().min(1),
      url: z.url(),
      previousHash: z.string().regex(/^[a-f0-9]{64}$/),
      proposedHash: z.string().regex(/^[a-f0-9]{64}$/),
      reviewStatus: z.literal("pending_review"),
    }),
  ),
});
export type KnowledgeStage = z.infer<typeof KnowledgeStageSchema>;

export interface KnowledgeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  /** Final URL after redirects, when the fetch implementation exposes it. */
  readonly url?: string;
  /** Optional to keep deterministic test fetchers small. */
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type KnowledgeFetcher = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<KnowledgeFetchResponse>;

export interface KnowledgeCheckOptions {
  readonly fetcher?: KnowledgeFetcher;
  readonly sourceIds?: readonly string[];
  readonly timeoutMs?: number;
  readonly checkedAt?: string;
}

export interface KnowledgeStageOptions {
  readonly report: KnowledgeCheckReport;
  readonly stagedAt?: string;
}

/**
 * An official provider page used only to discover potential catalog changes.
 * Unlike `SourceManifestEntry`, this is not an approved source for a rule.
 */
export const OfficialDiscoverySourceSchema = z.object({
  id: z.string().min(1),
  provider: TargetProfileSchema.shape.provider,
  title: z.string().min(1),
  url: z.url(),
  kind: z.enum(["model_catalog", "release_notes"]),
});
export type OfficialDiscoverySource = z.infer<
  typeof OfficialDiscoverySourceSchema
>;

/** A possible model or surface observed in an official provider document. */
const KnowledgeDiscoveryCandidateEvidenceSchema = z.object({
  provider: TargetProfileSchema.shape.provider,
  sourceId: z.string().min(1),
  url: z.url(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.iso.datetime(),
  evidenceExcerpt: z.string().min(1).max(280),
  // Discovery is deliberately weaker than a reviewed source or a staged rule.
  // It cannot be selected as a profile or rule input.
  reviewStatus: z.literal("discovered_unreviewed"),
});
export const KnowledgeDiscoveryCandidateSchema = z.discriminatedUnion("kind", [
  KnowledgeDiscoveryCandidateEvidenceSchema.extend({
    kind: z.literal("model"),
    model: z.string().min(1),
    surface: z.null(),
  }),
  KnowledgeDiscoveryCandidateEvidenceSchema.extend({
    kind: z.literal("surface"),
    model: z.null(),
    surface: TargetProfileSchema.shape.surface,
  }),
]);
export type KnowledgeDiscoveryCandidate = z.infer<
  typeof KnowledgeDiscoveryCandidateSchema
>;

/**
 * A human-reviewed discovery observation. It suppresses repeat alerts but is
 * not a target profile, capability declaration, or activation mechanism.
 */
const KnowledgeDiscoveryObservationBaseSchema = z.object({
  provider: TargetProfileSchema.shape.provider,
  classification: z.enum(["known_non_target", "rejected", "promoted"]),
  reviewedAt: z.iso.datetime(),
  rationale: z.string().min(12),
});
export const KnowledgeDiscoveryObservationSchema = z.discriminatedUnion("kind", [
  KnowledgeDiscoveryObservationBaseSchema.extend({
    kind: z.literal("model"),
    model: z.string().min(1),
    surface: z.null(),
  }),
  KnowledgeDiscoveryObservationBaseSchema.extend({
    kind: z.literal("surface"),
    model: z.null(),
    surface: TargetProfileSchema.shape.surface,
  }),
]);
export type KnowledgeDiscoveryObservation = z.infer<
  typeof KnowledgeDiscoveryObservationSchema
>;

export const KnowledgeDiscoveryReportSchema = z.object({
  status: z.enum(["current", "candidates_detected", "incomplete"]),
  candidates: z.array(KnowledgeDiscoveryCandidateSchema),
  suppressedObservations: z.array(KnowledgeDiscoveryObservationSchema),
  unavailableSourceIds: z.array(z.string().min(1)),
});
export type KnowledgeDiscoveryReport = z.infer<
  typeof KnowledgeDiscoveryReportSchema
>;

/**
 * Proposal-only refresh result. It intentionally has no activation path, rule
 * payload, or inferred capability fields: promotion requires separate review.
 */
export const KnowledgeRefreshReportSchema = z.object({
  packVersion: z.string().min(1),
  refreshedAt: z.iso.datetime(),
  activation: z.literal("blocked_pending_review"),
  sourceCheck: KnowledgeCheckReportSchema,
  discovery: KnowledgeDiscoveryReportSchema,
  affectedTargetIds: z.array(z.string().min(1)),
  promotion: z.object({
    status: z.literal("pending_review"),
    reasons: z.array(z.string().min(1)).min(1),
  }),
});
export type KnowledgeRefreshReport = z.infer<typeof KnowledgeRefreshReportSchema>;

export interface KnowledgeRefreshOptions extends KnowledgeCheckOptions {
  /** ISO time used for evidence provenance and deterministic tests. */
  readonly discoveredAt?: string;
  /** Reviewed catalog observations used to suppress repeat proposal alerts. */
  readonly reviewedObservations?: readonly KnowledgeDiscoveryObservation[];
}

export interface TargetProfileFilter {
  readonly provider?: KnowledgeTargetProfile["provider"];
  readonly surface?: KnowledgeTargetProfile["surface"];
  readonly availability?: KnowledgeTargetProfile["availability"];
  readonly deploymentMode?: KnowledgeTargetProfile["deployment"]["mode"];
}

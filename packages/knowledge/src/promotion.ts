import {
  KNOWLEDGE_PACK_VERSION,
  KnowledgePromotionDossierSchema,
  type KnowledgePromotionDossier,
  type KnowledgePromotionDossierOptions,
} from "./schemas.js";
import { officialDiscoveryRegistry } from "./discovery.js";
import { targetProfiles } from "./profiles.js";
import { sourceManifest } from "./sources.js";

function canonicalModel(value: string): string {
  return value.trim().toLowerCase().replace(/[ _]+/g, "-").replace(/-+/g, "-");
}

/**
 * Builds a review checklist for a newly observed model without inferring any
 * capabilities. The resulting dossier can be committed/reviewed, but cannot
 * alter the active pack or make the model selectable.
 */
export function createKnowledgePromotionDossier(
  options: KnowledgePromotionDossierOptions,
): KnowledgePromotionDossier {
  const model = canonicalModel(options.model);
  const discoveryEvidence = (options.discoveryCandidates ?? []).filter(
    (candidate) =>
      candidate.kind === "model" &&
      candidate.provider === options.provider &&
      canonicalModel(candidate.model) === model,
  );
  const adjacentProfiles = targetProfiles
    .filter((profile) => profile.provider === options.provider)
    .map((profile) => ({
      id: profile.id,
      model: profile.model,
      surface: profile.surface,
      sourceIds: [...profile.sourceIds],
    }));
  const existingProfileIds = adjacentProfiles
    .filter((profile) => canonicalModel(profile.model) === model)
    .map((profile) => profile.id);
  const discoveryStatus = existingProfileIds.length > 0
    ? "already_profiled"
    : discoveryEvidence.length > 0
      ? "catalog_observed"
      : "requested_without_catalog_evidence";
  const officialCatalogSources = officialDiscoveryRegistry
    .filter((source) => source.provider === options.provider)
    .map(({ id, url, title }) => ({ id, url, title }));
  const reviewedProviderSources = sourceManifest
    .filter((source) => source.provider === options.provider)
    .map(({ id, url, title }) => ({ id, url, title }));

  return KnowledgePromotionDossierSchema.parse({
    packVersion: KNOWLEDGE_PACK_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    activation: "blocked_pending_review",
    candidate: {
      provider: options.provider,
      model,
      discoveryStatus,
      discoveryEvidence,
      existingProfileIds,
    },
    sourcePlan: {
      officialCatalogSources,
      reviewedProviderSources,
      requiredEvidence: [
        "Record an official exact model identifier and cite the source snapshot/hash.",
        "Verify each intended surface independently (API, chat application, coding CLI, or other supported surface).",
        "Verify context limits, reasoning controls, tools, structured output, modalities, parameters, and continuation behavior from official documentation.",
        "Record unsupported or unknown capabilities explicitly; do not inherit them from an adjacent model.",
      ],
    },
    adjacentProfiles,
    requiredProfileFields: [
      "Exact provider, model ID, endpoint/surface, deployment variant, and availability.",
      "Roles, context window, reasoning modes/default, and state-preservation contract.",
      "Tools, structured output, modalities, caching, tool-choice, schema, and parameter constraints.",
      "Serialization, continuation, forbidden combinations, and every reviewed source ID.",
    ],
    requiredRuleWork: [
      "Create or explicitly decline model/surface-specific prompt rules using reviewed official evidence.",
      "Attach every new rule to a source hash and a deterministic conformance handler.",
      "Do not copy adjacent-model rules until their applicability is evidenced for this exact model and surface.",
      "Re-run cross-reference validation so every applicable rule source is declared by the new profile.",
    ],
    requiredTests: [
      "Positive runtime-resolution fixture for the exact provider, model, surface, reasoning mode, tools, and permissions metadata.",
      "Negative runtime-resolution fixtures for missing, alias-only, mismatched, and unsupported metadata; unknown must not fall back to an adjacent model.",
      "Adapter/capability matrix test proving native versus CLI-only status without implying a native integration.",
      "Target configuration and renderer golden tests for every proposed surface, including unsupported capability failures.",
      "Knowledge rule conformance, source/profile/rule cross-reference validation, and regression coverage for existing profiles.",
    ],
    requiredEvaluations: [
      "Run the demand-specific static evaluation suite against the new rendered target and an adjacent baseline.",
      "When an authorized native evaluator exists, run consented target evaluation with reproducible model/version, prompt, and result provenance.",
      "Review regressions in safety boundaries, tool use, structured outputs, long context, and reasoning-control behavior before promotion.",
    ],
    promotion: {
      status: "pending_human_review",
      blockers: [
        discoveryStatus === "catalog_observed"
          ? "Catalog evidence is discovery-only and has not been reviewed as a profile or rule source."
          : discoveryStatus === "already_profiled"
            ? "An active profile already exists; this command cannot revise or promote it."
            : "No matching discovery evidence was supplied; verify the model in an official catalog or release source first.",
        "A human-reviewed change must add the profile, rules, conformance handlers, and tests in a separate patch.",
        "Activation requires source review and evaluation evidence; this dossier has no activation path.",
      ],
      nonActivationGuarantee: "No active knowledge-pack files are changed by this dossier.",
    },
  });
}

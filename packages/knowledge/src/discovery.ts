import { createHash } from "node:crypto";
import {
  KNOWLEDGE_PACK_VERSION,
  KnowledgeDiscoveryCandidateSchema,
  KnowledgeRefreshReportSchema,
  OfficialDiscoverySourceSchema,
  type KnowledgeDiscoveryCandidate,
  type KnowledgeDiscoveryObservation,
  type KnowledgeFetchResponse,
  type KnowledgeRefreshOptions,
  type KnowledgeRefreshReport,
  type OfficialDiscoverySource,
} from "./schemas.js";
import { checkKnowledgeSources } from "./drift.js";
import { targetProfiles } from "./profiles.js";
import { sourceManifest } from "./sources.js";

const MAX_DISCOVERY_DOCUMENT_BYTES = 2 * 1024 * 1024;

/**
 * This registry is deliberately separate from `sourceManifest`: its pages are
 * official catalog/release discovery inputs, not reviewed evidence for prompt
 * rules. Coverage is explicit so gaps are visible rather than guessed.
 */
export const officialDiscoveryRegistry: readonly (OfficialDiscoverySource & {
  readonly coverage: "provider_model_catalog" | "provider_release_notes";
})[] = [
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "openai-model-catalog",
      provider: "openai",
      title: "OpenAI model catalog",
      url: "https://developers.openai.com/api/docs/models/",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "anthropic-model-catalog",
      provider: "anthropic",
      title: "Anthropic model overview",
      url: "https://platform.claude.com/docs/en/about-claude/models/overview",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "google-model-catalog",
      provider: "google",
      title: "Google Gemini model catalog",
      url: "https://ai.google.dev/gemini-api/docs/models",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "xai-model-catalog",
      provider: "xai",
      title: "xAI model catalog",
      url: "https://docs.x.ai/developers/models",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "deepseek-model-catalog",
      provider: "deepseek",
      title: "DeepSeek model updates",
      url: "https://api-docs.deepseek.com/news/news",
      kind: "release_notes",
    }),
    coverage: "provider_release_notes",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "meta-model-catalog",
      provider: "meta",
      title: "Meta Llama model catalog",
      url: "https://developer.meta.com/ai/llama-downloads/",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "mistral-model-catalog",
      provider: "mistral",
      title: "Mistral model catalog",
      url: "https://docs.mistral.ai/getting-started/models/models_overview/",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "kimi-model-catalog",
      provider: "kimi",
      title: "Kimi model overview",
      url: "https://platform.kimi.ai/docs/overview",
      kind: "model_catalog",
    }),
    coverage: "provider_model_catalog",
  },
  {
    ...OfficialDiscoverySourceSchema.parse({
      id: "hermes-release-notes",
      provider: "hermes",
      title: "Hermes Agent releases",
      url: "https://github.com/NousResearch/hermes-agent/releases",
      kind: "release_notes",
    }),
    coverage: "provider_release_notes",
  },
];

/** Provider-specific TLS origins. Discovery never follows an arbitrary URL. */
export const officialDiscoveryHosts = {
  openai: ["developers.openai.com"],
  anthropic: ["platform.claude.com"],
  google: ["ai.google.dev"],
  xai: ["docs.x.ai"],
  deepseek: ["api-docs.deepseek.com"],
  meta: ["developer.meta.com"],
  mistral: ["docs.mistral.ai"],
  kimi: ["platform.kimi.ai"],
  hermes: ["github.com"],
} as const;

/**
 * Checked-in, human-reviewed suppression inventory. Keep this empty until an
 * observation has been classified with evidence; discovery must not seed it.
 */
export const reviewedDiscoveryObservationInventory: readonly KnowledgeDiscoveryObservation[] =
  [];

const modelPatterns: Readonly<
  Record<OfficialDiscoverySource["provider"], RegExp>
> = {
  openai:
    /\b(?:gpt|o)[-_ ]\d+(?:\.\d+)?(?:[-_ ](?:mini|nano|pro|codex|max|latest|preview|realtime|audio|search)){0,3}\b/gi,
  anthropic:
    /\bclaude[-_ ](?:sonnet|opus|haiku)[-_ ]\d+(?:\.\d+)?\b/gi,
  google:
    /\bgemini[-_ ]\d+(?:\.\d+)?(?:[-_ ](?:pro|flash|flash-lite|image|preview|latest)){0,3}\b/gi,
  xai:
    /\bgrok[-_ ]\d+(?:\.\d+)?(?:[-_ ](?:fast|mini|beta|latest|preview)){0,2}\b/gi,
  deepseek:
    /\bdeepseek[-_ ](?:v?\d+(?:\.\d+)?|chat|reasoner)(?:[-_ ](?:chat|coder|lite|latest)){0,2}\b/gi,
  meta:
    /\bllama[-_ ]\d+(?:[-_ ](?:maverick|scout|instruct|vision|chat|\d+b|\d+e)){0,5}\b/gi,
  mistral:
    /\bmistral[-_ ](?:large|small|medium|codestral|magistral)[-_ ]\d+(?:[-_ ]\d+){0,3}\b/gi,
  kimi: /\bkimi[-_ ]k?\d+(?:\.\d+)?(?:[-_ ]code)?\b/gi,
  hermes: /\bhermes[-_ ]\d+(?:\.\d+)?(?:[-_ ](?:pro|coder|latest)){0,2}\b/gi,
};

const surfaceMarkers: readonly {
  readonly match: RegExp;
  readonly surface: "api" | "chat_app" | "coding_cli" | "open_weights" | "agent_cli";
}[] = [
  { match: /\b(?:responses|messages|generate content) api\b/i, surface: "api" },
  { match: /\b(?:chatgpt|claude\.ai|web chat)\b/i, surface: "chat_app" },
  { match: /\b(?:codex|claude code|coding cli)\b/i, surface: "coding_cli" },
  { match: /\b(?:open weights?|model weights?)\b/i, surface: "open_weights" },
  { match: /\b(?:agent cli|terminal agent)\b/i, surface: "agent_cli" },
];

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function canonicalModel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ _]+/g, "-")
    .replace(/-+/g, "-");
}

function observationKey(
  kind: "model" | "surface",
  provider: OfficialDiscoverySource["provider"],
  model: string | null,
  surface: KnowledgeDiscoveryCandidate["surface"],
): string {
  return `${kind}:${provider}:${model ?? ""}:${surface ?? ""}`;
}

function excerpt(content: string, start: number, length: number): string {
  const sliceStart = Math.max(0, start - 96);
  const sliceEnd = Math.min(content.length, start + length + 144);
  return content.slice(sliceStart, sliceEnd).replace(/\s+/g, " ").trim();
}

function isTrustedDiscoverySource(source: OfficialDiscoverySource): boolean {
  const url = new URL(source.url);
  return (
    url.protocol === "https:" &&
    officialDiscoveryHosts[source.provider].includes(
      url.hostname as never,
    )
  );
}

function responseStayedOnTrustedHost(
  source: OfficialDiscoverySource,
  response: KnowledgeFetchResponse,
): boolean {
  if (response.url === undefined || response.url.length === 0) {
    return true;
  }
  try {
    const url = new URL(response.url);
    return (
      url.protocol === "https:" &&
      officialDiscoveryHosts[source.provider].includes(url.hostname as never)
    );
  } catch {
    return false;
  }
}

function contentTypeIsReadable(response: KnowledgeFetchResponse): boolean {
  const value = response.headers?.get("content-type");
  return (
    value === null ||
    value === undefined ||
    /(?:text|json|xml|javascript)/i.test(value)
  );
}

function extractCandidates(
  source: OfficialDiscoverySource,
  body: string,
  observedAt: string,
  observations: ReadonlyMap<string, KnowledgeDiscoveryObservation>,
): {
  readonly candidates: readonly KnowledgeDiscoveryCandidate[];
  readonly suppressedObservations: readonly KnowledgeDiscoveryObservation[];
} {
  const evidenceHash = sha256(body);
  const knownModels = new Set(
    targetProfiles
      .filter((profile) => profile.provider === source.provider)
      .map((profile) => canonicalModel(profile.model)),
  );
  const knownSurfaces = new Set(
    targetProfiles
      .filter((profile) => profile.provider === source.provider)
      .map((profile) => profile.surface),
  );
  const candidates: KnowledgeDiscoveryCandidate[] = [];
  const suppressedObservations: KnowledgeDiscoveryObservation[] = [];
  const seen = new Set<string>();
  const modelPattern = new RegExp(modelPatterns[source.provider].source, "gi");

  for (const match of body.matchAll(modelPattern)) {
    const rawModel = match[0];
    const model = canonicalModel(rawModel);
    if (knownModels.has(model)) {
      continue;
    }
    const reviewed = observations.get(
      observationKey("model", source.provider, model, null),
    );
    if (reviewed !== undefined) {
      suppressedObservations.push(reviewed);
      continue;
    }
    const key = `model:${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(
      KnowledgeDiscoveryCandidateSchema.parse({
        kind: "model",
        provider: source.provider,
        model,
        surface: null,
        sourceId: source.id,
        url: source.url,
        evidenceHash,
        observedAt,
        evidenceExcerpt: excerpt(body, match.index ?? 0, rawModel.length),
        reviewStatus: "discovered_unreviewed",
      }),
    );
  }

  for (const marker of surfaceMarkers) {
    const match = marker.match.exec(body);
    if (match === null || knownSurfaces.has(marker.surface)) {
      continue;
    }
    const reviewed = observations.get(
      observationKey("surface", source.provider, null, marker.surface),
    );
    if (reviewed !== undefined) {
      suppressedObservations.push(reviewed);
      continue;
    }
    const key = `surface:${marker.surface}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(
      KnowledgeDiscoveryCandidateSchema.parse({
        kind: "surface",
        provider: source.provider,
        model: null,
        surface: marker.surface,
        sourceId: source.id,
        url: source.url,
        evidenceHash,
        observedAt,
        evidenceExcerpt: excerpt(body, match.index ?? 0, match[0].length),
        reviewStatus: "discovered_unreviewed",
      }),
    );
  }

  return { candidates, suppressedObservations };
}

const defaultFetcher = async (
  url: string,
  init: { readonly signal: AbortSignal },
): Promise<KnowledgeFetchResponse> =>
  fetch(url, {
    signal: init.signal,
    headers: {
      "user-agent": `explain-it-better/${KNOWLEDGE_PACK_VERSION}`,
      "accept-language": "en",
    },
  });

async function discoverFromSource(
  source: OfficialDiscoverySource,
  fetcher: NonNullable<KnowledgeRefreshOptions["fetcher"]>,
  timeoutMs: number,
  observedAt: string,
  observations: ReadonlyMap<string, KnowledgeDiscoveryObservation>,
): Promise<ReturnType<typeof extractCandidates> | null> {
  if (!isTrustedDiscoverySource(source)) {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const response = await fetcher(source.url, { signal: controller.signal });
    if (
      !response.ok ||
      !contentTypeIsReadable(response) ||
      !responseStayedOnTrustedHost(source, response)
    ) {
      return null;
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_DISCOVERY_DOCUMENT_BYTES) {
      return null;
    }
    return extractCandidates(source, body, observedAt, observations);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Checks reviewed sources and independently scans official provider catalogs.
 * This produces evidence-only, non-active candidates; it never mutates the
 * knowledge pack, profiles, rules, or runtime configuration.
 */
export async function refreshKnowledgeUpdates(
  options: KnowledgeRefreshOptions = {},
): Promise<KnowledgeRefreshReport> {
  const sourceCheck = await checkKnowledgeSources(options);
  const selectedProviders =
    options.sourceIds === undefined
      ? null
      : new Set(
          sourceManifest
            .filter((source) => options.sourceIds?.includes(source.id))
            .map((source) => source.provider),
        );
  const sources = officialDiscoveryRegistry.filter(
    (source) => selectedProviders === null || selectedProviders.has(source.provider),
  );
  const observedAt = options.discoveredAt ?? options.checkedAt ?? new Date().toISOString();
  const fetcher = options.fetcher ?? defaultFetcher;
  const observations = [
    ...reviewedDiscoveryObservationInventory,
    ...(options.reviewedObservations ?? []),
  ];
  const observationsByKey = new Map(
    observations.map((observation) => [
      observationKey(
        observation.kind,
        observation.provider,
        observation.model,
        observation.surface,
      ),
      observation,
    ]),
  );
  const discoveries = await Promise.all(
    sources.map(async (source) => ({
      source,
      candidates: await discoverFromSource(
        source,
        fetcher,
        options.timeoutMs ?? 15_000,
        observedAt,
        observationsByKey,
      ),
    })),
  );
  const unavailableSourceIds = discoveries
    .filter((entry) => entry.candidates === null)
    .map((entry) => entry.source.id);
  const candidates = discoveries.flatMap(
    (entry) => entry.candidates?.candidates ?? [],
  );
  const suppressedObservations = [
    ...new Map(
      discoveries
        .flatMap((entry) => entry.candidates?.suppressedObservations ?? [])
        .map((observation) => [
          observationKey(
            observation.kind,
            observation.provider,
            observation.model,
            observation.surface,
          ),
          observation,
        ]),
    ).values(),
  ];
  const changedSourceIds = new Set(
    sourceCheck.checks
      .filter((entry) => entry.status === "changed")
      .map((entry) => entry.sourceId),
  );
  const candidateProviders = new Set(candidates.map((candidate) => candidate.provider));
  const affectedTargetIds = targetProfiles
    .filter(
      (profile) =>
        profile.sourceIds.some((id) => changedSourceIds.has(id)) ||
        candidateProviders.has(profile.provider),
    )
    .map((profile) => profile.id);
  const reasons = [
    "Automatic activation is disabled; source review, rule conformance, and evaluation are required before promotion.",
  ];
  if (sourceCheck.status !== "current") {
    reasons.push(`Reviewed source check is ${sourceCheck.status}.`);
  }
  if (candidates.length > 0) {
    reasons.push(`${candidates.length} unreviewed official catalog candidate(s) require classification.`);
  }
  if (unavailableSourceIds.length > 0) {
    reasons.push(`Official discovery sources unavailable: ${unavailableSourceIds.join(", ")}.`);
  }
  return KnowledgeRefreshReportSchema.parse({
    packVersion: KNOWLEDGE_PACK_VERSION,
    refreshedAt: observedAt,
    activation: "blocked_pending_review",
    sourceCheck,
    discovery: {
      status:
        unavailableSourceIds.length > 0
          ? "incomplete"
          : candidates.length > 0
            ? "candidates_detected"
            : "current",
      candidates,
      suppressedObservations,
      unavailableSourceIds,
    },
    affectedTargetIds,
    promotion: { status: "pending_review", reasons },
  });
}

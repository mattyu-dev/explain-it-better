import { createHash } from "node:crypto";
import {
  KNOWLEDGE_PACK_VERSION,
  KnowledgeDiscoveryCandidateSchema,
  KnowledgeDiscoveryResolvedEntrySchema,
  KnowledgeRefreshReportSchema,
  OfficialDiscoverySourceSchema,
  type KnowledgeDiscoveryCandidate,
  type KnowledgeDiscoveryFetchReceipt,
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

type DiscoveryProvider = OfficialDiscoverySource["provider"];

/**
 * These patterns deliberately live behind source adapters instead of one
 * generic HTML scraper. Each adapter is tied to one official provider page
 * and applies the provider's naming grammar plus availability exclusions.
 * They remain discovery evidence only, never profile/capability inference.
 */
const providerModelPatterns: Readonly<Record<DiscoveryProvider, RegExp>> = {
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

const historicalMarkers =
  /\b(?:deprecated|retired|legacy|historical|previous(?:ly)?|superseded|sunset|no longer available|migration from)\b/i;
const nonModelExampleMarkers =
  /\b(?:example|sample|placeholder|your[-_ ]model[-_ ]id)\b/i;

interface ExtractedToken {
  readonly kind: "model" | "surface";
  readonly model: string | null;
  readonly surface: KnowledgeDiscoveryCandidate["surface"];
  readonly index: number;
  readonly length: number;
}

interface DiscoverySourceAdapter {
  readonly id: string;
  readonly extractorId: string;
  extract(body: string): readonly ExtractedToken[];
}

function isCurrentCatalogContext(body: string, index: number, length: number): boolean {
  // Scope exclusions to the local sentence/list item. A historical model on
  // the same long page must not suppress a nearby current catalog entry.
  const before = body.lastIndexOf(".", index - 1);
  const after = body.indexOf(".", index + length);
  const start = Math.max(0, before < 0 ? index - 180 : before + 1);
  const end = Math.min(body.length, after < 0 ? index + length + 180 : after + 1);
  const context = body.slice(start, end);
  return !historicalMarkers.test(context) && !nonModelExampleMarkers.test(context);
}

function extractProviderModels(
  provider: DiscoveryProvider,
  body: string,
): readonly ExtractedToken[] {
  const pattern = new RegExp(providerModelPatterns[provider].source, "gi");
  const tokens: ExtractedToken[] = [];
  for (const match of body.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index ?? 0;
    // A catalog/release adapter must never treat historical documentation or
    // an arbitrary example string as a new release announcement.
    if (!isCurrentCatalogContext(body, index, raw.length)) {
      continue;
    }
    tokens.push({
      kind: "model",
      model: canonicalModel(raw),
      surface: null,
      index,
      length: raw.length,
    });
  }
  return tokens;
}

function extractExplicitSurfaceMarkers(body: string): readonly ExtractedToken[] {
  const tokens: ExtractedToken[] = [];
  // Surface observations need an explicit machine-readable declaration. Do
  // not infer them from prose such as a blog post mentioning "Codex".
  const pattern = /data-eib-surface=["'](api|chat_app|coding_cli|open_weights|agent_cli)["']/gi;
  for (const match of body.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (!isCurrentCatalogContext(body, index, raw.length)) {
      continue;
    }
    tokens.push({
      kind: "surface",
      model: null,
      surface: match[1] as KnowledgeDiscoveryCandidate["surface"],
      index,
      length: raw.length,
    });
  }
  return tokens;
}

function providerAdapter(source: OfficialDiscoverySource): DiscoverySourceAdapter {
  return {
    id: source.id,
    extractorId: `${source.provider}-${source.kind}-v1`,
    extract: (body) => [
      ...extractProviderModels(source.provider, body),
      ...extractExplicitSurfaceMarkers(body),
    ],
  };
}

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
  for (const token of providerAdapter(source).extract(body)) {
    if (token.kind === "model" && token.model !== null && knownModels.has(token.model)) {
      continue;
    }
    if (token.kind === "surface" && token.surface !== null && knownSurfaces.has(token.surface)) {
      continue;
    }
    const reviewed = observations.get(
      observationKey(token.kind, source.provider, token.model, token.surface),
    );
    if (reviewed !== undefined) {
      suppressedObservations.push(reviewed);
      continue;
    }
    const key = observationKey(token.kind, source.provider, token.model, token.surface);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(
      KnowledgeDiscoveryCandidateSchema.parse({
        kind: token.kind,
        provider: source.provider,
        model: token.model,
        surface: token.surface,
        sourceId: source.id,
        url: source.url,
        evidenceHash,
        observedAt,
        evidenceExcerpt: excerpt(body, token.index, token.length),
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
): Promise<{
  readonly extraction: ReturnType<typeof extractCandidates> | null;
  readonly receipt: KnowledgeDiscoveryFetchReceipt;
}> {
  const adapter = providerAdapter(source);
  const receipt = (
    values: Omit<KnowledgeDiscoveryFetchReceipt, "sourceId" | "requestedUrl" | "extractorId">,
  ): KnowledgeDiscoveryFetchReceipt => ({
    sourceId: source.id,
    requestedUrl: source.url,
    extractorId: adapter.extractorId,
    ...values,
  });
  if (!isTrustedDiscoverySource(source)) {
    return {
      extraction: null,
      receipt: receipt({
        finalUrl: null,
        httpStatus: null,
        contentType: null,
        bodyBytes: null,
        bodyHash: null,
        outcome: "untrusted_source",
        error: "Configured discovery URL is not an allowlisted HTTPS provider origin.",
      }),
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const response = await fetcher(source.url, { signal: controller.signal });
    const finalUrl = response.url ?? source.url;
    const contentType = response.headers?.get("content-type") ?? null;
    if (!response.ok) {
      return {
        extraction: null,
        receipt: receipt({
          finalUrl,
          httpStatus: response.status,
          contentType,
          bodyBytes: null,
          bodyHash: null,
          outcome: "http_error",
          error: `Official source returned HTTP ${response.status}.`,
        }),
      };
    }
    if (!responseStayedOnTrustedHost(source, response)) {
      return {
        extraction: null,
        receipt: receipt({
          finalUrl,
          httpStatus: response.status,
          contentType,
          bodyBytes: null,
          bodyHash: null,
          outcome: "untrusted_redirect",
          error: "Final response URL is outside the provider allowlist.",
        }),
      };
    }
    if (!contentTypeIsReadable(response)) {
      return {
        extraction: null,
        receipt: receipt({
          finalUrl,
          httpStatus: response.status,
          contentType,
          bodyBytes: null,
          bodyHash: null,
          outcome: "unsupported_content_type",
          error: "Official source did not return readable text, JSON, XML, or JavaScript.",
        }),
      };
    }
    const advertisedLength = Number(response.headers?.get("content-length"));
    // Reject a truthful oversized response before materializing its text in
    // memory. The post-read byte check below remains mandatory because this
    // header is optional and not trusted as a safety boundary.
    if (Number.isSafeInteger(advertisedLength) && advertisedLength > MAX_DISCOVERY_DOCUMENT_BYTES) {
      return {
        extraction: null,
        receipt: receipt({
          finalUrl,
          httpStatus: response.status,
          contentType,
          bodyBytes: advertisedLength,
          bodyHash: null,
          outcome: "oversize_document",
          error: `Official source advertised ${advertisedLength} bytes, above the ${MAX_DISCOVERY_DOCUMENT_BYTES} byte discovery limit.`,
        }),
      };
    }
    const body = await response.text();
    const bodyBytes = Buffer.byteLength(body, "utf8");
    const bodyHash = sha256(body);
    if (bodyBytes > MAX_DISCOVERY_DOCUMENT_BYTES) {
      return {
        extraction: null,
        receipt: receipt({
          finalUrl,
          httpStatus: response.status,
          contentType,
          bodyBytes,
          bodyHash,
          outcome: "oversize_document",
          error: `Official source exceeded ${MAX_DISCOVERY_DOCUMENT_BYTES} byte discovery limit.`,
        }),
      };
    }
    return {
      extraction: extractCandidates(source, body, observedAt, observations),
      receipt: receipt({
        finalUrl,
        httpStatus: response.status,
        contentType,
        bodyBytes,
        bodyHash,
        outcome: "ok",
        error: null,
      }),
    };
  } catch (error) {
    return {
      extraction: null,
      receipt: receipt({
        finalUrl: null,
        httpStatus: null,
        contentType: null,
        bodyBytes: null,
        bodyHash: null,
        outcome: "fetch_error",
        error: error instanceof Error ? error.message : "Unknown fetch error.",
      }),
    };
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
      result: await discoverFromSource(
        source,
        fetcher,
        options.timeoutMs ?? 15_000,
        observedAt,
        observationsByKey,
      ),
    })),
  );
  const unavailableSourceIds = discoveries
    .filter((entry) => entry.result.extraction === null)
    .map((entry) => entry.source.id);
  const candidates = discoveries.flatMap(
    (entry) => entry.result.extraction?.candidates ?? [],
  );
  const suppressedObservations = [
    ...new Map(
      discoveries
        .flatMap((entry) => entry.result.extraction?.suppressedObservations ?? [])
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
  const receipts = discoveries.map((entry) => entry.result.receipt);
  const baseline = options.discoveryBaseline;
  const baselineByKey = new Map(
    (baseline ?? []).map((entry) => [
      observationKey(entry.kind, entry.provider, entry.model, entry.surface),
      entry,
    ]),
  );
  const candidateByKey = new Map(
    candidates.map((candidate) => [
      observationKey(candidate.kind, candidate.provider, candidate.model, candidate.surface),
      candidate,
    ]),
  );
  const newCandidates = baseline === undefined
    ? candidates
    : candidates.filter((candidate) => !baselineByKey.has(
      observationKey(candidate.kind, candidate.provider, candidate.model, candidate.surface),
    ));
  const changedCandidates = baseline === undefined
    ? []
    : candidates.filter((candidate) => {
      const prior = baselineByKey.get(
        observationKey(candidate.kind, candidate.provider, candidate.model, candidate.surface),
      );
      return prior !== undefined && prior.evidenceHash !== candidate.evidenceHash;
    });
  // A source that failed to fetch cannot prove an observation resolved. Only
  // compare baseline entries for sources that produced a readable receipt.
  const readableSourceIds = new Set(
    receipts.filter((entry) => entry.outcome === "ok").map((entry) => entry.sourceId),
  );
  const resolvedCandidates = (baseline ?? [])
    .filter((entry) =>
      readableSourceIds.has(entry.sourceId) &&
      !candidateByKey.has(observationKey(entry.kind, entry.provider, entry.model, entry.surface)),
    )
    .map((entry) => KnowledgeDiscoveryResolvedEntrySchema.parse({
      kind: entry.kind,
      provider: entry.provider,
      model: entry.model,
      surface: entry.surface,
      sourceId: entry.sourceId,
      previousEvidenceHash: entry.evidenceHash,
      firstObservedAt: entry.firstObservedAt,
      lastObservedAt: entry.lastObservedAt,
      resolvedAt: observedAt,
      reviewStatus: "discovered_unreviewed",
    }));
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
      delta: {
        baselineStatus: baseline === undefined ? "not_provided" : "compared",
        newCandidates,
        changedCandidates,
        resolvedCandidates,
      },
      receipts,
    },
    affectedTargetIds,
    promotion: { status: "pending_review", reasons },
  });
}

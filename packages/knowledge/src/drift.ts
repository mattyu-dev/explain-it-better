import { createHash } from "node:crypto";
import {
  KnowledgeCheckReportSchema,
  KnowledgeStageSchema,
  KNOWLEDGE_PACK_VERSION,
  type KnowledgeCheckOptions,
  type KnowledgeCheckReport,
  type KnowledgeFetcher,
  type KnowledgeSourceCheck,
  type KnowledgeStage,
  type KnowledgeStageOptions,
} from "./schemas.js";
import { sourceManifest } from "./sources.js";

const defaultFetcher: KnowledgeFetcher = async (url, init) => {
  return fetch(url, {
    signal: init.signal,
    headers: {
      "user-agent": `explain-it-better/${KNOWLEDGE_PACK_VERSION}`,
      // Reviewed manifest signals are English documentation phrases. Pin the
      // locale so a localized response cannot produce a false drift finding.
      "accept-language": "en",
    },
  });
};

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function checkOneSource(
  source: (typeof sourceManifest)[number],
  fetcher: KnowledgeFetcher,
  timeoutMs: number,
): Promise<KnowledgeSourceCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const response = await fetcher(source.url, { signal: controller.signal });
    if (!response.ok) {
      return {
        sourceId: source.id,
        url: source.url,
        status: "unreachable",
        driftStrategy: source.driftStrategy,
        expectedHash: source.contentHash,
        observedHash: null,
        hashMatches: null,
        signalsMatch: null,
        decisionBasis: "unreachable",
        httpStatus: response.status,
        missingSignals: [],
        error: `HTTP ${response.status}`,
      };
    }
    const body = await response.text();
    const observedHash = sha256(body);
    const missingSignals = source.expectedSignals.filter(
      (signal) => !body.includes(signal),
    );
    const hashMatches = observedHash === source.contentHash;
    const signalsMatch = missingSignals.length === 0;
    const status =
      source.driftStrategy === "full_hash"
        ? signalsMatch && hashMatches
          ? "current"
          : "changed"
        : signalsMatch
          ? "current"
          : "changed";
    return {
      sourceId: source.id,
      url: source.url,
      status,
      driftStrategy: source.driftStrategy,
      expectedHash: source.contentHash,
      observedHash,
      hashMatches,
      signalsMatch,
      decisionBasis:
        source.driftStrategy === "full_hash"
          ? "full_hash_and_signals"
          : "required_signals",
      httpStatus: response.status,
      missingSignals,
      error: null,
    };
  } catch (error) {
    return {
      sourceId: source.id,
      url: source.url,
      status: "unreachable",
      driftStrategy: source.driftStrategy,
      expectedHash: source.contentHash,
      observedHash: null,
      hashMatches: null,
      signalsMatch: null,
      decisionBasis: "unreachable",
      httpStatus: null,
      missingSignals: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkKnowledgeSources(
  options: KnowledgeCheckOptions = {},
): Promise<KnowledgeCheckReport> {
  const selectedIds =
    options.sourceIds === undefined ? null : new Set(options.sourceIds);
  const selected = sourceManifest.filter(
    (source) => selectedIds === null || selectedIds.has(source.id),
  );
  if (selectedIds !== null) {
    const knownIds = new Set(selected.map((source) => source.id));
    const unknown = [...selectedIds].filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown knowledge source id(s): ${unknown.join(", ")}`);
    }
  }

  const checks = await Promise.all(
    selected.map((source) =>
      checkOneSource(
        source,
        options.fetcher ?? defaultFetcher,
        options.timeoutMs ?? 15_000,
      ),
    ),
  );
  const status = checks.some((entry) => entry.status === "unreachable")
    ? "incomplete"
    : checks.some((entry) => entry.status === "changed")
      ? "drift_detected"
      : "current";
  return KnowledgeCheckReportSchema.parse({
    packVersion: KNOWLEDGE_PACK_VERSION,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    status,
    checks,
  });
}

export function stageKnowledgeUpdates(
  options: KnowledgeStageOptions,
): KnowledgeStage {
  const report = KnowledgeCheckReportSchema.parse(options.report);
  return KnowledgeStageSchema.parse({
    packVersion: report.packVersion,
    stagedAt: options.stagedAt ?? new Date().toISOString(),
    activation: "blocked_pending_review",
    changes: report.checks
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          readonly status: "changed";
          readonly observedHash: string;
        } => entry.status === "changed" && entry.observedHash !== null,
      )
      .map((entry) => ({
        sourceId: entry.sourceId,
        url: entry.url,
        previousHash: entry.expectedHash,
        proposedHash: entry.observedHash,
        reviewStatus: "pending_review" as const,
      })),
  });
}

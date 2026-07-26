import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  KnowledgeRefreshReportSchema,
  checkKnowledgeSources,
  createKnowledgePromotionDossier,
  refreshKnowledgeUpdates,
  stageKnowledgeUpdates,
  type KnowledgeDiscoveryCandidate,
} from "@eib/knowledge";
import type { CliCommand } from "./args/types.js";
import { ExitCode as Codes } from "./args/types.js";
import { CliServiceError, type CliServiceResult } from "./service-contracts.js";

export interface KnowledgeWorkflowOptions {
  /** Injectable proposal-only refresh keeps tests and embedding network-free. */
  readonly refresh?: typeof refreshKnowledgeUpdates;
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was cancelled.", "AbortError");
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    assertNotAborted(signal);
  }
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => {
      rejectPromise(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was cancelled.", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function writeJsonExclusive(path: string, value: unknown): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const handle = await open(absolute, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return absolute;
}

function parseCandidate(candidate: string): { provider: string; model: string } {
  const separator = candidate.indexOf("/");
  const provider = candidate.slice(0, separator).trim();
  const model = candidate.slice(separator + 1).trim();
  if (separator <= 0 || provider.length === 0 || model.length === 0 || model.includes("/")) {
    throw new CliServiceError("knowledge promote-plan requires exactly <provider/model>.", Codes.usage);
  }
  return { provider, model };
}

export async function executeKnowledgeCommand(
  command: Extract<CliCommand, { name: "knowledge" }>,
  signal: AbortSignal,
  options: KnowledgeWorkflowOptions = {},
): Promise<CliServiceResult> {
  if (command.action === "promote-plan") {
    const { provider, model } = parseCandidate(command.candidate!);
    let discoveryCandidates: readonly KnowledgeDiscoveryCandidate[] = [];
    if (command.proposalPath !== undefined) {
      let proposed: unknown;
      try {
        proposed = JSON.parse(await readFile(command.proposalPath, "utf8")) as unknown;
      } catch (error) {
        throw new CliServiceError(
          `Could not read refresh proposal ${JSON.stringify(command.proposalPath)}.`,
          Codes.usage,
          error instanceof Error ? { reason: error.message } : undefined,
        );
      }
      const parsedProposal = KnowledgeRefreshReportSchema.safeParse(proposed);
      if (!parsedProposal.success) {
        throw new CliServiceError(
          `Refresh proposal ${JSON.stringify(command.proposalPath)} is invalid.`,
          Codes.usage,
          { issues: parsedProposal.error.issues },
        );
      }
      discoveryCandidates = parsedProposal.data.discovery.candidates;
    }
    let dossier;
    try {
      dossier = createKnowledgePromotionDossier({ provider: provider as never, model, discoveryCandidates });
    } catch (error) {
      throw new CliServiceError(
        `Unknown or invalid promotion candidate ${JSON.stringify(command.candidate)}.`,
        Codes.usage,
        error instanceof Error ? { reason: error.message } : undefined,
      );
    }
    const output = command.output ?? join(".eib", "knowledge", `promotion-${provider}-${dossier.candidate.model}.json`);
    const written = await writeJsonExclusive(output, dossier);
    return {
      status: "ok",
      message: `Wrote a non-active promotion dossier at ${written} for ${dossier.candidate.provider}/${dossier.candidate.model}. No profile, rule, capability, or active knowledge-pack file was changed.`,
      data: { dossier, written },
      exitCode: Codes.success,
    };
  }

  if (command.action === "refresh") {
    const proposal = await abortable(
      (options.refresh ?? refreshKnowledgeUpdates)({
        ...(command.sourceIds.length === 0 ? {} : { sourceIds: command.sourceIds }),
      }),
      signal,
    );
    assertNotAborted(signal);
    const output = command.output ?? join(
      ".eib",
      "knowledge",
      `refresh-${proposal.refreshedAt.replaceAll(":", "-").replaceAll(".", "-")}.json`,
    );
    const written = await writeJsonExclusive(output, proposal);
    const candidateCount = proposal.discovery.candidates.length;
    const affectedTargetCount = proposal.affectedTargetIds.length;
    const incomplete = proposal.sourceCheck.status === "incomplete" || proposal.discovery.unavailableSourceIds.length > 0;
    return {
      status: "ok",
      message: `Wrote a non-active knowledge refresh proposal at ${written} (${candidateCount} discovered candidate${candidateCount === 1 ? "" : "s"}; ${affectedTargetCount} affected target${affectedTargetCount === 1 ? "" : "s"}). Activation remains blocked pending source and rule review.`,
      data: { proposal, written },
      exitCode: incomplete ? Codes.error : Codes.success,
    };
  }

  const report = await abortable(
    checkKnowledgeSources({ ...(command.sourceIds.length === 0 ? {} : { sourceIds: command.sourceIds }) }),
    signal,
  );
  assertNotAborted(signal);
  if (command.action === "check") {
    return {
      status: "ok",
      message: report.status === "current" ? "Knowledge sources match the reviewed manifest." : `Knowledge source status: ${report.status}.`,
      data: report,
      exitCode: report.status === "current" ? Codes.success : Codes.error,
    };
  }
  const staged = stageKnowledgeUpdates({ report });
  const output = command.output ?? join(".eib", "knowledge", `staged-${staged.stagedAt.replaceAll(":", "-").replaceAll(".", "-")}.json`);
  const written = await writeJsonExclusive(output, staged);
  return {
    status: "ok",
    message: `Staged a non-active knowledge review at ${written}.`,
    data: { staged, written },
    exitCode: report.status === "incomplete" ? Codes.error : Codes.success,
  };
}

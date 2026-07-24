import { createHash, randomUUID } from "node:crypto";
import {
  EvalResultSchema,
  PromptPackageSchema,
  type EvalCase,
  type ExternalEvaluationProvenance,
  type PromptPackage,
  type VerificationStatus,
} from "../contracts.js";
import {
  advanceVerificationStatus,
  invalidateVerificationAt,
  isVerificationAtLeast,
} from "./verification.js";

export type ExternalEvaluationMode = "proxy" | "live";
export type ExternalEvalResult = ReturnType<typeof EvalResultSchema.parse>;

export interface ExternalEvaluationRequest {
  readonly mode: ExternalEvaluationMode;
  readonly allowExecution?: boolean;
  readonly repetitions?: 1 | 3 | 5;
  readonly signal?: AbortSignal;
}

export interface ExternalEvaluationInvocation {
  readonly mode: ExternalEvaluationMode;
  readonly promptPackage: PromptPackage;
  readonly evalCases: readonly EvalCase[];
  readonly repetition: number;
  readonly signal?: AbortSignal;
}

export interface ExternalEvaluationBackend {
  readonly id: string;
  evaluate(invocation: ExternalEvaluationInvocation): Promise<readonly unknown[]>;
}

export interface ExternalEvaluationReport {
  readonly mode: ExternalEvaluationMode;
  readonly backendId: string;
  readonly repetitions: number;
  readonly passed: boolean;
  readonly results: readonly ExternalEvalResult[];
  readonly promptPackage: PromptPackage;
}

function requiredVerification(mode: ExternalEvaluationMode): VerificationStatus {
  return mode === "proxy" ? "proxy_evaluated" : "target_evaluated";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Evaluation was aborted.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Hash the immutable subject, deliberately excluding execution evidence/state. */
function subjectHash(promptPackage: PromptPackage): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        id: promptPackage.id,
        blueprint: promptPackage.blueprint,
        artifacts: promptPackage.artifacts,
        evals: promptPackage.evals,
        knowledge: promptPackage.knowledge,
      }),
    )
    .digest("hex");
}

function withoutUntrustedProvenance(rawResult: unknown): unknown {
  if (!isRecord(rawResult)) return rawResult;
  const result = { ...rawResult };
  Reflect.deleteProperty(result, "provenance");
  return result;
}

/**
 * No backend exists implicitly. Callers must both inject one and explicitly
 * authorize this invocation, so merely constructing or loading a package can
 * never execute a model, command, or network request.
 */
export async function runExternalEvaluation(
  promptPackage: PromptPackage,
  request: ExternalEvaluationRequest,
  backend: ExternalEvaluationBackend,
): Promise<ExternalEvaluationReport> {
  const validatedPackage = PromptPackageSchema.parse(promptPackage);
  if (request.allowExecution !== true) {
    throw new Error(
      `${request.mode} evaluation is disabled by default; set allowExecution to true after explicit user confirmation.`,
    );
  }
  if (request.mode !== "proxy" && request.mode !== "live") {
    throw new Error(`Unsupported external evaluation mode ${JSON.stringify(request.mode)}.`);
  }
  if (backend.id.trim().length === 0) {
    throw new Error("External evaluation backend id cannot be empty.");
  }
  if (!isVerificationAtLeast(validatedPackage.verification, "statically_validated")) {
    throw new Error("Static validation must pass before proxy or live evaluation.");
  }
  throwIfAborted(request.signal);

  const repetitions = request.repetitions ?? 3;
  if (repetitions !== 1 && repetitions !== 3 && repetitions !== 5) {
    throw new Error("Evaluation repetitions must be 1, 3, or 5.");
  }
  const expectedCaseIds = new Set(validatedPackage.evals.map((evalCase) => evalCase.id));
  const expectedTargetIds = new Set(validatedPackage.artifacts.map((artifact) => artifact.targetId));
  const expectedPairs = new Set(
    [...expectedCaseIds].flatMap((caseId) =>
      [...expectedTargetIds].map((targetId) => `${caseId}\u0000${targetId}`),
    ),
  );
  if (expectedCaseIds.size === 0 || expectedTargetIds.size === 0) {
    throw new Error("External evaluation requires evaluation cases and compiled targets.");
  }
  const staticResults = validatedPackage.results.filter(
    (result) => result.mode === "static",
  );
  const passingStaticPairs = new Set(
    staticResults
      .filter((result) => result.passed)
      .map((result) => `${result.caseId}\u0000${result.targetId}`),
  );
  if (
    staticResults.length !== expectedPairs.size ||
    passingStaticPairs.size !== expectedPairs.size ||
    [...expectedPairs].some((pair) => !passingStaticPairs.has(pair))
  ) {
    throw new Error(
      "External evaluation requires complete passing static evidence for every case/target pair.",
    );
  }
  const runId = randomUUID();
  const evaluatedAt = new Date().toISOString();
  const evaluatedSubjectHash = subjectHash(validatedPackage);
  const results: ExternalEvalResult[] = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    throwIfAborted(request.signal);
    const invocation: ExternalEvaluationInvocation = {
      mode: request.mode,
      promptPackage: validatedPackage,
      evalCases: validatedPackage.evals,
      repetition,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const rawResults = await backend.evaluate(invocation);
    const repetitionPairs = new Set<string>();
    for (const rawResult of rawResults) {
      const parsed = EvalResultSchema.parse(withoutUntrustedProvenance(rawResult));
      const provenance: ExternalEvaluationProvenance = {
        runId,
        backendId: backend.id,
        repetition: repetition + 1,
        totalRepetitions: repetitions,
        evaluatedAt,
        subjectHash: evaluatedSubjectHash,
      };
      const result = EvalResultSchema.parse({ ...parsed, provenance });
      if (result.mode !== request.mode) {
        throw new Error(
          `Backend ${JSON.stringify(backend.id)} returned mode ${JSON.stringify(result.mode)} during ${request.mode} evaluation.`,
        );
      }
      if (!expectedCaseIds.has(result.caseId)) {
        throw new Error(
          `Backend ${JSON.stringify(backend.id)} returned unknown case id ${JSON.stringify(result.caseId)}.`,
        );
      }
      const pair = `${result.caseId}\u0000${result.targetId}`;
      if (repetitionPairs.has(pair)) {
        throw new Error(
          `Backend ${JSON.stringify(backend.id)} returned duplicate case/target pair ${JSON.stringify(result.caseId)} / ${JSON.stringify(result.targetId)} in one repetition.`,
        );
      }
      if (!expectedTargetIds.has(result.targetId)) {
        throw new Error(
          `Backend ${JSON.stringify(backend.id)} returned unknown target id ${JSON.stringify(result.targetId)}.`,
        );
      }
      repetitionPairs.add(pair);
      results.push(result);
    }
    const missingPairs = [...expectedPairs].filter((pair) => !repetitionPairs.has(pair));
    if (missingPairs.length > 0) {
      throw new Error(
        `Backend ${JSON.stringify(backend.id)} omitted case/target pairs: ${missingPairs
          .map((pair) => pair.replace("\u0000", " / "))
          .join(", ")}.`,
      );
    }
  }

  const expectedResultCount = validatedPackage.evals.length * expectedTargetIds.size * repetitions;
  if (results.length !== expectedResultCount) {
    throw new Error(
      `Backend ${JSON.stringify(backend.id)} returned ${results.length} results; expected ${expectedResultCount}.`,
    );
  }

  const passed = results.every((result) => result.passed);
  const retainedResults = validatedPackage.results.filter((result) => result.mode !== request.mode);
  const verification = passed
    ? advanceVerificationStatus(validatedPackage.verification, requiredVerification(request.mode))
    : invalidateVerificationAt(validatedPackage.verification, requiredVerification(request.mode));
  const nextPackage = PromptPackageSchema.parse({
    ...validatedPackage,
    results: [...retainedResults, ...results],
    verification,
  });

  return {
    mode: request.mode,
    backendId: backend.id,
    repetitions,
    passed,
    results,
    promptPackage: nextPackage,
  };
}

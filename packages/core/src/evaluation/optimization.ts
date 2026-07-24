import { z } from "zod";
import { EvalCaseSchema, VerificationStatusSchema } from "../contracts.js";

export const PromptCandidateSchema = z.object({
  id: z.string().min(1),
  dimension: z.enum(["baseline", "verification_emphasis", "workflow_emphasis"]),
  blueprintId: z.string().min(1),
  semanticPrompt: z.string().min(1),
  changeLog: z.array(z.string().min(1)).min(1),
});

export const CandidateEvaluationRunSchema = z.object({
  candidateId: z.string().min(1),
  caseId: z.string().min(1),
  repetition: z.number().int().nonnegative(),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  criticalRegression: z.boolean(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
});

export interface CandidateEvaluationRun {
  readonly candidateId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly score: number;
  readonly passed: boolean;
  readonly criticalRegression: boolean;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export const BlindedComparisonSchema = z.object({
  caseId: z.string().min(1),
  leftCandidateId: z.string().min(1),
  rightCandidateId: z.string().min(1),
  winnerCandidateId: z.string().min(1).nullable(),
});

export interface BlindedComparison {
  readonly caseId: string;
  readonly leftCandidateId: string;
  readonly rightCandidateId: string;
  readonly winnerCandidateId: string | null;
}

export interface SelectBestCandidateOptions {
  readonly baselineCandidateId: string;
  readonly minimumImprovement?: number;
  readonly comparisons?: readonly BlindedComparison[];
}

export interface CandidateSummary {
  readonly candidateId: string;
  readonly meanScore: number;
  readonly passRate: number;
  readonly meanLatencyMs: number;
  readonly totalInputTokens: number | null;
  readonly totalOutputTokens: number | null;
  readonly totalCost: number | null;
  readonly criticalRegressions: number;
}

export interface BestCandidateReport {
  readonly promoted: boolean;
  readonly selectedCandidateId: string;
  readonly baselineCandidateId: string;
  readonly measuredImprovement: number;
  readonly reason: string;
  readonly summaries: readonly CandidateSummary[];
}

export const CandidateSummarySchema = z.object({
  candidateId: z.string().min(1),
  meanScore: z.number().min(0).max(1),
  passRate: z.number().min(0).max(1),
  meanLatencyMs: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative().nullable(),
  totalOutputTokens: z.number().int().nonnegative().nullable(),
  totalCost: z.number().nonnegative().nullable(),
  criticalRegressions: z.number().int().nonnegative(),
});

export const BestCandidateReportSchema = z.object({
  promoted: z.boolean(),
  selectedCandidateId: z.string().min(1),
  baselineCandidateId: z.string().min(1),
  measuredImprovement: z.number(),
  reason: z.string().min(1),
  summaries: z.array(CandidateSummarySchema).min(1).max(3),
});

const CandidateEvidenceContractSchema = z.object({
  runs: z.string().min(1),
  comparisons: z.string().min(1),
  promotion: z.string().min(1),
  verification: z.string().min(1),
});

const CandidateOptimizationBaseSchema = z.object({
  version: z.literal(1),
  sourcePackage: z.object({
    id: z.string().min(1),
    verification: VerificationStatusSchema,
  }),
  baselineCandidateId: z.string().min(1),
  candidates: z.array(PromptCandidateSchema).min(1).max(3),
  heldOutCases: z.array(EvalCaseSchema).min(1),
  evidenceContract: CandidateEvidenceContractSchema,
});

/** A serializable plan with no evaluation result or promotion claim. */
export const CandidateOptimizationPlanSchema = CandidateOptimizationBaseSchema.extend({
  state: z.literal("awaiting_evidence"),
});

/**
 * A serializable evidence artifact. This is intentionally separate from a
 * prompt package: a promotion recommendation cannot silently alter compiled
 * artifacts or elevate their verification status.
 */
export const CandidateOptimizationEvidenceSchema = CandidateOptimizationBaseSchema.extend({
  state: z.literal("evaluated"),
  minimumImprovement: z.number().nonnegative(),
  runs: z.array(CandidateEvaluationRunSchema).min(1),
  comparisons: z.array(BlindedComparisonSchema).optional(),
  report: BestCandidateReportSchema,
});

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function optionalTotal(
  runs: readonly CandidateEvaluationRun[],
  field: "inputTokens" | "outputTokens" | "cost",
): number | null {
  const values = runs.map((run) => run[field]);
  return values.every((value): value is number => value !== undefined)
    ? values.reduce((total, value) => total + value, 0)
    : null;
}

function runKey(run: CandidateEvaluationRun): string {
  return `${run.caseId}\u0000${String(run.repetition)}`;
}

function assertIdenticalHeldOutRuns(
  grouped: ReadonlyMap<string, readonly CandidateEvaluationRun[]>,
): void {
  const entries = [...grouped.entries()];
  const reference = entries[0];
  if (reference === undefined) {
    throw new Error("Candidate optimization requires evaluation runs.");
  }
  const expected = [...new Set(reference[1].map(runKey))].sort();
  if (expected.length !== reference[1].length) {
    throw new Error(`Candidate ${reference[0]} has duplicate held-out runs.`);
  }
  for (const [candidateId, runs] of entries.slice(1)) {
    const actual = [...new Set(runs.map(runKey))].sort();
    if (actual.length !== runs.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Candidate ${candidateId} was not evaluated on the identical held-out cases and repetitions.`,
      );
    }
  }
}

function assertReversedOrderCoverage(comparisons: readonly BlindedComparison[]): void {
  const directions = new Set(
    comparisons.map(
      (comparison) =>
        `${comparison.caseId}\u0000${comparison.leftCandidateId}\u0000${comparison.rightCandidateId}`,
    ),
  );
  for (const comparison of comparisons) {
    const reverse =
      `${comparison.caseId}\u0000${comparison.rightCandidateId}\u0000${comparison.leftCandidateId}`;
    if (!directions.has(reverse)) {
      throw new Error(
        `Subjective comparison for ${comparison.caseId} lacks reversed candidate order.`,
      );
    }
    if (
      comparison.winnerCandidateId !== null &&
      comparison.winnerCandidateId !== comparison.leftCandidateId &&
      comparison.winnerCandidateId !== comparison.rightCandidateId
    ) {
      throw new Error("A comparison winner must be one of its two candidates or null.");
    }
  }
}

/**
 * Promotes only a challenger tested on the exact same held-out runs as the
 * baseline. Pre-scored subjective trials are accepted only with reversed order
 * coverage, preventing a one-sided presentation from becoming promotion proof.
 */
export function selectBestTestedCandidate(
  runs: readonly CandidateEvaluationRun[],
  options: SelectBestCandidateOptions,
): BestCandidateReport {
  if (
    options.baselineCandidateId.trim().length === 0 ||
    (options.minimumImprovement !== undefined &&
      (!Number.isFinite(options.minimumImprovement) || options.minimumImprovement < 0))
  ) {
    throw new Error("Minimum improvement cannot be negative.");
  }
  const grouped = new Map<string, CandidateEvaluationRun[]>();
  for (const run of runs) {
    if (
      run.candidateId.trim().length === 0 ||
      run.caseId.trim().length === 0 ||
      !Number.isFinite(run.score) ||
      run.score < 0 ||
      run.score > 1 ||
      !Number.isFinite(run.latencyMs) ||
      run.latencyMs < 0 ||
      !Number.isInteger(run.repetition) ||
      run.repetition < 0 ||
      (run.inputTokens !== undefined &&
        (!Number.isFinite(run.inputTokens) || !Number.isInteger(run.inputTokens) || run.inputTokens < 0)) ||
      (run.outputTokens !== undefined &&
        (!Number.isFinite(run.outputTokens) || !Number.isInteger(run.outputTokens) || run.outputTokens < 0)) ||
      (run.cost !== undefined && (!Number.isFinite(run.cost) || run.cost < 0))
    ) {
      throw new Error("Candidate evaluation runs contain an invalid score, duration, or repetition.");
    }
    grouped.set(run.candidateId, [...(grouped.get(run.candidateId) ?? []), run]);
  }
  if (grouped.size === 0 || grouped.size > 3) {
    throw new Error("Candidate optimization requires between one and three candidates.");
  }
  if (!grouped.has(options.baselineCandidateId)) {
    throw new Error("The baseline candidate has no evaluation runs.");
  }
  assertIdenticalHeldOutRuns(grouped);
  assertReversedOrderCoverage(options.comparisons ?? []);

  const summaries = [...grouped.entries()].map(([candidateId, candidateRuns]) => ({
    candidateId,
    meanScore: average(candidateRuns.map((run) => run.score)),
    passRate: candidateRuns.filter((run) => run.passed).length / candidateRuns.length,
    meanLatencyMs: average(candidateRuns.map((run) => run.latencyMs)),
    totalInputTokens: optionalTotal(candidateRuns, "inputTokens"),
    totalOutputTokens: optionalTotal(candidateRuns, "outputTokens"),
    totalCost: optionalTotal(candidateRuns, "cost"),
    criticalRegressions: candidateRuns.filter((run) => run.criticalRegression).length,
  }));
  const baseline = summaries.find(
    (summary) => summary.candidateId === options.baselineCandidateId,
  );
  if (baseline === undefined) throw new Error("The baseline summary is unavailable.");
  const eligible = summaries
    .filter(
      (summary) =>
        summary.criticalRegressions === 0 &&
        summary.passRate === 1 &&
        summary.passRate >= baseline.passRate,
    )
    .sort(
      (left, right) =>
        right.meanScore - left.meanScore ||
        right.passRate - left.passRate ||
        left.meanLatencyMs - right.meanLatencyMs ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const best = eligible[0] ?? baseline;
  const measuredImprovement = best.meanScore - baseline.meanScore;
  const minimumImprovement = options.minimumImprovement ?? 0;
  const promoted =
    best.candidateId !== baseline.candidateId &&
    measuredImprovement > minimumImprovement;

  return {
    promoted,
    selectedCandidateId: promoted ? best.candidateId : baseline.candidateId,
    baselineCandidateId: baseline.candidateId,
    measuredImprovement,
    reason: promoted
      ? "Challenger improved the identical held-out suite with no critical regression."
      : "No challenger cleared the measurable-improvement and critical-regression gate.",
    summaries,
  };
}

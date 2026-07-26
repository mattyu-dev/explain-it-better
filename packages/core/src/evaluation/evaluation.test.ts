import { describe, expect, it, vi } from "vitest";
import { EvalResultSchema } from "../contracts.js";
import type { z } from "zod";
import { makePromptPackage } from "../package/test-fixtures.js";
import {
  evaluateStatic,
  runDeterministicCheck,
  runOutputSchemaCheck,
  STRUCTURE_ONLY_WARNING,
} from "./static.js";
import {
  PROMPT_QUALITY_EVALUATION_CONTRACT,
  runExternalEvaluation,
  type ExternalEvaluationInvocation,
} from "./external.js";
import {
  advanceVerificationStatus,
  invalidateVerificationAt,
  isVerificationAtLeast,
  VERIFICATION_LADDER,
} from "./verification.js";
import {
  CandidateOptimizationEvidenceSchema,
  selectBestTestedCandidate,
} from "./optimization.js";
import type { CandidateEvaluationRun } from "./optimization.js";

type EvalResult = z.infer<typeof EvalResultSchema>;

describe("verification ladder", () => {
  it("is monotonic and ordered", () => {
    expect(VERIFICATION_LADDER).toEqual([
      "compiled",
      "statically_validated",
      "proxy_evaluated",
      "target_evaluated",
      "human_approved",
    ]);
    expect(advanceVerificationStatus("target_evaluated", "statically_validated")).toBe(
      "target_evaluated",
    );
    expect(isVerificationAtLeast("proxy_evaluated", "statically_validated")).toBe(true);
    expect(invalidateVerificationAt("human_approved", "proxy_evaluated")).toBe(
      "statically_validated",
    );
    expect(invalidateVerificationAt("target_evaluated", "target_evaluated")).toBe(
      "proxy_evaluated",
    );
  });
});

function staticallyValidatedPackage() {
  const promptPackage = makePromptPackage();
  return evaluateStatic(
    promptPackage,
    Object.fromEntries(
      promptPackage.evals.map((evalCase) => [
        evalCase.id,
        evalCase.category === "output_schema" ? "{}" : "answer",
      ]),
    ),
  ).promptPackage;
}

function completeStaticOutputs(promptPackage: ReturnType<typeof makePromptPackage>) {
  return Object.fromEntries(
    promptPackage.evals.map((evalCase) => [
      evalCase.id,
      evalCase.category === "output_schema" ? "{}" : "answer",
    ]),
  );
}

function optimizationEvidenceFixture() {
  const source = makePromptPackage();
  const candidates = [
    {
      id: "baseline",
      dimension: "baseline" as const,
      promptSpecId: "frozen-demand",
      semanticPrompt: "Answer the demand exactly.",
      promptHash: "a".repeat(64),
      changeLog: ["Canonical baseline."],
    },
    {
      id: "challenger",
      dimension: "reasoning_structure" as const,
      promptSpecId: "frozen-demand",
      semanticPrompt: "Answer the demand with an explicit quality check.",
      promptHash: "b".repeat(64),
      changeLog: ["Adds an output-quality check."],
    },
  ];
  const runs = candidates.flatMap((candidate, candidateIndex) =>
    source.evals.map((evalCase) => ({
      candidateId: candidate.id,
      targetId: "openai-gpt",
      promptHash: candidate.promptHash,
      caseId: evalCase.id,
      repetition: 0,
      score: candidateIndex === 0 ? 0.8 : 0.9,
      passed: true,
      criticalRegression: false,
      latencyMs: 10,
      provenance: {
        backendId: "codex",
        runnerId: "codex-cli-structured-v1",
        modelId: "gpt-5.6-codex",
        runId: "4d1d055f-0d7a-405d-8f7e-a4db2b3bc563",
        evaluatedAt: "2026-07-24T12:00:00.000Z",
        observableEvidence: [`${candidate.id} satisfied ${evalCase.id}.`],
      },
    })),
  );
  const report = selectBestTestedCandidate(runs, {
    baselineCandidateId: "baseline",
    minimumImprovement: 0.05,
  });
  return {
    version: 1 as const,
    sourcePackage: { id: source.id, verification: source.verification },
    promptSpecId: "frozen-demand",
    targetId: "openai-gpt",
    baselineCandidateId: "baseline",
    candidates,
    heldOutCases: source.evals,
    evidenceContract: {
      runs: "Every candidate, case, and repetition is required.",
      comparisons: "Use blinded reversed order when subjective comparisons are supplied.",
      promotion: "Require measurable improvement with no critical regression.",
      verification: "Promotion evidence never upgrades source verification.",
    },
    state: "evaluated" as const,
    minimumImprovement: 0.05,
    runs,
    report,
  };
}

describe("deterministic static evaluation", () => {
  it("reports a structurally complete package without claiming behavioral static validation", () => {
    const promptPackage = makePromptPackage();
    const report = evaluateStatic(promptPackage);
    expect(report.passed).toBe(true);
    expect(report.promptPackage.verification).toBe("compiled");
    expect(promptPackage.verification).toBe("compiled");
    expect(report.findings).toContainEqual({
      code: "evaluation.structure_only",
      severity: "warning",
      message:
        "No task-output fixtures were supplied. This run validates package structure only and provides no behavioral evidence.",
    });
    expect(report.results).toEqual([]);
    expect(report.promptPackage.warnings).toContain(STRUCTURE_ONLY_WARNING);
  });

  it("runs only the bounded declarative check language", () => {
    expect(runDeterministicCheck("valid_json", '{"ok":true}').passed).toBe(true);
    expect(runDeterministicCheck("includes:evidence", "with evidence").passed).toBe(true);
    const refused = runDeterministicCheck("exec:rm -rf /", "anything");
    expect(refused.passed).toBe(false);
    expect(refused.evidence).toContain("refused");
  });

  it("validates output-schema cases against the declared schema", () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string", minLength: 2 },
      },
      required: ["answer"],
      additionalProperties: false,
    };
    expect(runOutputSchemaCheck('{"answer":"ok"}', schema).passed).toBe(true);
    const invalid = runOutputSchemaCheck('{"answer":"","extra":true}', schema);
    expect(invalid.passed).toBe(false);
    expect(invalid.evidence).toContain("declared JSON Schema");

    const promptPackage = makePromptPackage();
    const outputs = Object.fromEntries(
      promptPackage.evals.map((evalCase) => [
        evalCase.id,
        evalCase.category === "output_schema" ? "{}" : "answer",
      ]),
    );
    const report = evaluateStatic(promptPackage, outputs);
    expect(report.passed).toBe(true);
    expect(report.findings.map((finding) => finding.code)).not.toContain(
      "evaluation.structure_only",
    );
    expect(report.promptPackage.warnings).not.toContain(STRUCTURE_ONLY_WARNING);
    expect(report.results).toHaveLength(promptPackage.evals.length);
    expect(report.results.every((result) => result.metrics?.outputValidity === 1)).toBe(true);
  });

  it("fails closed on recursive or excessively branching output schemas while allowing finite recursion", () => {
    const recursiveCycle = {
      $ref: "#/$defs/loop",
      $defs: {
        loop: { $ref: "#/$defs/loop" },
      },
    };
    const cycleResult = runOutputSchemaCheck("null", recursiveCycle);
    expect(cycleResult.passed).toBe(false);
    expect(cycleResult.evidence).toContain("recursive schema reference");

    const finiteRecursiveSchema = {
      $ref: "#/$defs/node",
      $defs: {
        node: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              properties: { next: { $ref: "#/$defs/node" } },
              required: ["next"],
              additionalProperties: false,
            },
          ],
        },
      },
    };
    expect(runOutputSchemaCheck('{"next":{"next":null}}', finiteRecursiveSchema).passed).toBe(true);

    let branchingSchema: Record<string, unknown> = { type: "null" };
    for (let depth = 0; depth < 13; depth += 1) {
      branchingSchema = { allOf: [branchingSchema, branchingSchema] };
    }
    const branchingResult = runOutputSchemaCheck("null", branchingSchema);
    expect(branchingResult.passed).toBe(false);
    expect(branchingResult.evidence).toContain("work budget");
  });

  it("requires complete output fixtures and all suite categories", () => {
    const promptPackage = makePromptPackage();
    const incomplete = evaluateStatic(promptPackage, { "case-1": "answer" });
    expect(incomplete.passed).toBe(false);
    expect(incomplete.findings.map((finding) => finding.code)).toContain("output.incomplete");

    const missingCategory = {
      ...promptPackage,
      evals: promptPackage.evals.slice(0, -1),
    };
    const report = evaluateStatic(missingCategory);
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("eval.missing_category");
  });

  it("invalidates stale static and higher verification when replacement fixtures fail", () => {
    const verified = staticallyValidatedPackage();
    const failingOutputs = {
      ...completeStaticOutputs(makePromptPackage()),
      "case-1": "",
    };
    const report = evaluateStatic(
      { ...verified, verification: "proxy_evaluated" },
      failingOutputs,
    );
    expect(report.passed).toBe(false);
    expect(report.promptPackage.verification).toBe("compiled");
    expect(report.promptPackage.results.some((result) => !result.passed)).toBe(true);
  });

  it("allows non-JSON output contracts without a JSON schema and requires a JSON check for JSON", () => {
    const promptPackage = makePromptPackage();
    const missingSchema = {
      ...promptPackage,
      prompt: {
        ...promptPackage.prompt,
        demand: {
          ...promptPackage.prompt.demand,
          outputContract: {
            ...promptPackage.prompt.demand.outputContract,
            schema: undefined,
          },
        },
      },
    };
    const nonJsonReport = evaluateStatic(missingSchema);
    expect(nonJsonReport.passed).toBe(true);

    const jsonWithoutCheck = {
      ...missingSchema,
      prompt: {
        ...missingSchema.prompt,
        demand: {
          ...missingSchema.prompt.demand,
          outputContract: {
            ...missingSchema.prompt.demand.outputContract,
            format: "JSON",
          },
        },
      },
    };
    const jsonReport = evaluateStatic(jsonWithoutCheck);
    expect(jsonReport.passed).toBe(false);
    expect(jsonReport.findings.map((finding) => finding.code)).toContain(
      "eval.output_json_missing_check",
    );
  });

  it("records static fixture results against every compiled target", () => {
    const promptPackage = makePromptPackage();
    const multiTarget = {
      ...promptPackage,
      artifacts: [
        ...promptPackage.artifacts,
        { ...promptPackage.artifacts[0]!, targetId: "anthropic-claude", filename: "prompt.txt" },
      ],
    };
    const report = evaluateStatic(
      multiTarget,
      Object.fromEntries(
        promptPackage.evals.map((evalCase) => [
          evalCase.id,
          evalCase.category === "output_schema" ? "{}" : "answer",
        ]),
      ),
    );
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(promptPackage.evals.length * 2);
    expect(new Set(report.results.map((result) => result.targetId))).toEqual(
      new Set(["openai-gpt", "anthropic-claude"]),
    );
  });
});

describe("evaluation metrics contract", () => {
  it("accepts observed metrics and rejects invalid ranges", () => {
    const result = EvalResultSchema.parse({
      caseId: "case-1",
      passed: true,
      score: 0.9,
      evidence: ["Measured by a deterministic grader."],
      mode: "proxy",
      targetId: "openai-gpt",
      durationMs: 12,
      metrics: {
        intentPreservation: 0.95,
        completeness: 0.9,
        outputValidity: 1,
        evidence: null,
        toolChoice: null,
        permissionCompliance: 1,
        unsupportedSettings: 1,
        clarificationBurden: 1,
        latencyMs: 12,
        inputTokens: 20,
        outputTokens: 10,
        cost: { amount: 0.01, currency: "USD" },
      },
    });
    expect(result.metrics?.cost).toEqual({ amount: 0.01, currency: "USD" });

    expect(() =>
      EvalResultSchema.parse({
        ...result,
        metrics: { intentPreservation: 1.1 },
      }),
    ).toThrow();
  });
});

describe("external evaluation boundary", () => {
  it("does not invoke an injected backend without explicit authorization", async () => {
    const promptPackage = staticallyValidatedPackage();
    const evaluate = vi.fn(
      (): Promise<readonly EvalResult[]> => Promise.resolve([]),
    );
    await expect(
      runExternalEvaluation(
        promptPackage,
        { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage) },
        { id: "fake", evaluate },
      ),
    ).rejects.toThrow("disabled by default");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("validates complete backend results and advances evidence level", async () => {
    const promptPackage = staticallyValidatedPackage();
    const evaluate = vi.fn(
      (invocation: ExternalEvaluationInvocation): Promise<readonly EvalResult[]> =>
        Promise.resolve(invocation.evalCases.map((evalCase) => ({
          caseId: evalCase.id,
          passed: true,
          score: 1,
          evidence: ["Fixture passed."],
          mode: invocation.mode,
          targetId: "openai-gpt",
          durationMs: 1,
        }))),
    );
    const report = await runExternalEvaluation(
      promptPackage,
      { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
      { id: "fake", evaluate },
    );
    expect(report.passed).toBe(true);
    expect(report.promptPackage.verification).toBe("proxy_evaluated");
    expect(evaluate).toHaveBeenCalledOnce();
    const invocation = evaluate.mock.calls[0]?.[0];
    expect(invocation?.focus).toBe("prompt_quality");
    expect(invocation?.evaluationContract).toEqual(PROMPT_QUALITY_EVALUATION_CONTRACT);
  });

  it("rejects blank evidence because a score alone is not prompt-quality proof", async () => {
    const promptPackage = staticallyValidatedPackage();
    await expect(
      runExternalEvaluation(
        promptPackage,
        { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
        {
          id: "no-quality-evidence",
          evaluate: (invocation) =>
            Promise.resolve(
              invocation.evalCases.map((evalCase) => ({
                caseId: evalCase.id,
                passed: true,
                score: 1,
                evidence: ["  "],
                mode: invocation.mode,
                targetId: "openai-gpt",
                durationMs: 1,
              })),
            ),
        },
      ),
    ).rejects.toThrow(/no observable prompt-quality evidence/iu);
  });

  it("recomputes static validation instead of trusting forged imported results", async () => {
    const source = staticallyValidatedPackage();
    const forged = {
      ...source,
      verification: "statically_validated" as const,
      results: source.results.map((result) => ({ ...result, passed: true, score: 1 })),
    };
    const evaluate = vi.fn(() => Promise.resolve([]));
    await expect(
      runExternalEvaluation(
        forged,
        {
          mode: "proxy",
          staticOutputs: { ...completeStaticOutputs(source), "case-1": "" },
          allowExecution: true,
          repetitions: 1,
        },
        { id: "fake", evaluate },
      ),
    ).rejects.toThrow("fresh passing static validation run");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects duplicate results even when the backend returns the expected count", async () => {
    const promptPackage = staticallyValidatedPackage();
    const evaluate = vi.fn(
      (invocation: ExternalEvaluationInvocation): Promise<readonly EvalResult[]> =>
        Promise.resolve(
          invocation.evalCases.map(() => ({
            caseId: invocation.evalCases[0]!.id,
            passed: true,
            score: 1,
            evidence: ["Duplicated fixture."],
            mode: invocation.mode,
            targetId: "openai-gpt",
            durationMs: 1,
          })),
        ),
    );
    await expect(
      runExternalEvaluation(
        promptPackage,
        { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
        { id: "fake", evaluate },
      ),
    ).rejects.toThrow("duplicate case/target pair");
  });

  it("requires every case for every compiled target in each repetition", async () => {
    const source = staticallyValidatedPackage();
    const multiTarget = {
      ...source,
      verification: "compiled" as const,
      artifacts: [
        ...source.artifacts,
        { ...source.artifacts[0]!, targetId: "anthropic-claude", filename: "prompt.txt" },
      ],
      results: [],
    };
    const promptPackage = evaluateStatic(
      multiTarget,
      completeStaticOutputs(makePromptPackage()),
    ).promptPackage;
    await expect(
      runExternalEvaluation(
        promptPackage,
        { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
        {
          id: "single-target-fixture",
          evaluate: (invocation) =>
            Promise.resolve(
              invocation.evalCases.map((evalCase) => ({
                caseId: evalCase.id,
                passed: true,
                score: 1,
                evidence: ["Fixture passed."],
                mode: invocation.mode,
                targetId: "openai-gpt",
                durationMs: 1,
              })),
            ),
        },
      ),
    ).rejects.toThrow("omitted case/target pairs");
  });

  it("persists trusted provenance and overwrites backend-provided provenance", async () => {
    const promptPackage = staticallyValidatedPackage();
    const report = await runExternalEvaluation(
      promptPackage,
      { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 3 },
      {
        id: "trusted-backend",
        evaluate: (invocation) =>
          Promise.resolve(
            invocation.evalCases.map((evalCase) => ({
              caseId: evalCase.id,
              passed: true,
              score: 1,
              evidence: ["Fixture passed."],
              mode: invocation.mode,
              targetId: "openai-gpt",
              durationMs: 1,
              provenance: { tampered: true },
            })),
          ),
      },
    );
    expect(report.results).toHaveLength(promptPackage.evals.length * 3);
    const provenance = report.results.map((result) => result.provenance);
    expect(provenance.every((item) => item?.backendId === "trusted-backend")).toBe(true);
    expect(provenance.every((item) => item?.totalRepetitions === 3)).toBe(true);
    expect(new Set(provenance.map((item) => item?.runId)).size).toBe(1);
    expect(new Set(provenance.map((item) => item?.subjectHash)).size).toBe(1);
    expect(provenance.map((item) => item?.repetition).sort()).toEqual(
      [1, 2, 3].flatMap((repetition) =>
        Array.from({ length: promptPackage.evals.length }, () => repetition),
      ),
    );
    expect(provenance.every((item) => item?.subjectHash.match(/^[a-f0-9]{64}$/u))).toBe(true);
    expect(report.promptPackage.results.filter((result) => result.mode === "proxy")).toEqual(
      report.results,
    );
  });

  it("does not advance verification when an external evaluation fails", async () => {
    const promptPackage = staticallyValidatedPackage();
    const evaluate = (
      invocation: ExternalEvaluationInvocation,
    ): Promise<readonly EvalResult[]> =>
      Promise.resolve(
        invocation.evalCases.map((evalCase, index) => ({
          caseId: evalCase.id,
          passed: index !== 0,
          score: index === 0 ? 0 : 1,
          evidence: [index === 0 ? "Critical requirement failed." : "Fixture passed."],
          mode: invocation.mode,
          targetId: "openai-gpt",
          durationMs: 1,
        })),
      );

    const report = await runExternalEvaluation(
      promptPackage,
      { mode: "live", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
      { id: "native-fixture", evaluate },
    );
    expect(report.passed).toBe(false);
    expect(report.promptPackage.verification).toBe("statically_validated");
  });

  it("removes a failed mode's verification claim when replacing its prior results", async () => {
    const promptPackage = staticallyValidatedPackage();
    const passing = (invocation: ExternalEvaluationInvocation): Promise<readonly EvalResult[]> =>
      Promise.resolve(
        invocation.evalCases.map((evalCase) => ({
          caseId: evalCase.id,
          passed: true,
          score: 1,
          evidence: ["Fixture passed."],
          mode: invocation.mode,
          targetId: "openai-gpt",
          durationMs: 1,
        })),
      );
    const successful = await runExternalEvaluation(
      promptPackage,
      { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
      { id: "passing", evaluate: passing },
    );
    const failed = await runExternalEvaluation(
      successful.promptPackage,
      { mode: "proxy", staticOutputs: completeStaticOutputs(promptPackage), allowExecution: true, repetitions: 1 },
      {
        id: "failing",
        evaluate: (invocation) =>
          Promise.resolve(
            invocation.evalCases.map((evalCase) => ({
              caseId: evalCase.id,
              passed: false,
              score: 0,
              evidence: ["Fixture failed."],
              mode: invocation.mode,
              targetId: "openai-gpt",
              durationMs: 1,
            })),
          ),
      },
    );
    expect(failed.passed).toBe(false);
    expect(failed.promptPackage.verification).toBe("statically_validated");
    expect(failed.promptPackage.results.filter((result) => result.mode === "proxy").every(
      (result) => !result.passed,
    )).toBe(true);
  });
});

describe("best-tested candidate promotion", () => {
  const run = (
    candidateId: string,
    caseId: string,
    score: number,
    criticalRegression = false,
  ) => ({
    candidateId,
    targetId: "openai-gpt",
    promptHash: candidateId === "baseline" ? "a".repeat(64) : "b".repeat(64),
    caseId,
    repetition: 0,
    score,
    passed: score >= 0.8,
    criticalRegression,
    latencyMs: 10,
    provenance: {
      backendId: "codex",
      runnerId: "codex-cli-structured-v1",
      modelId: "gpt-5.6-codex",
      runId: "4d1d055f-0d7a-405d-8f7e-a4db2b3bc563",
      evaluatedAt: "2026-07-24T12:00:00.000Z",
      observableEvidence: [`${candidateId} satisfied ${caseId}.`],
    },
  });

  it("requires identical held-out cases and promotes a measurable clean improvement", () => {
    expect(() =>
      selectBestTestedCandidate(
        [run("baseline", "one", 0.7), run("challenger", "different", 0.9)],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/identical held-out/iu);

    const report = selectBestTestedCandidate(
      [
        run("baseline", "one", 0.7),
        run("baseline", "two", 0.8),
        run("challenger", "one", 0.9),
        run("challenger", "two", 0.9),
      ],
      { baselineCandidateId: "baseline", minimumImprovement: 0.05 },
    );
    expect(report.promoted).toBe(true);
    expect(report.selectedCandidateId).toBe("challenger");
  });

  it("blocks critical regressions and one-sided subjective comparisons", () => {
    const runs = [
      run("baseline", "one", 0.7),
      run("challenger", "one", 1, true),
    ];
    expect(
      selectBestTestedCandidate(runs, { baselineCandidateId: "baseline" }).promoted,
    ).toBe(false);
    expect(() =>
      selectBestTestedCandidate(runs, {
        baselineCandidateId: "baseline",
        comparisons: [
          {
            caseId: "one",
            leftCandidateId: "baseline",
            rightCandidateId: "challenger",
            winnerCandidateId: "challenger",
          },
        ],
      }),
    ).toThrow(/reversed candidate order/iu);
  });

  it("does not promote a challenger with failed required runs and rejects non-finite values", () => {
    const failedChallenger = selectBestTestedCandidate(
      [run("baseline", "one", 0.8), { ...run("challenger", "one", 0.99), passed: false }],
      { baselineCandidateId: "baseline" },
    );
    expect(failedChallenger.promoted).toBe(false);
    expect(() =>
      selectBestTestedCandidate(
        [run("baseline", "one", Number.NaN), run("challenger", "one", 0.9)],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/invalid score/iu);
    expect(() =>
      selectBestTestedCandidate(
        [run("", "one", 0.8), run("challenger", "one", 0.9)],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/invalid score/iu);
  });

  it("refuses cross-target, mutable-prompt, mixed-provenance, and duplicate-comparison evidence", () => {
    expect(() =>
      selectBestTestedCandidate(
        [
          run("baseline", "one", 0.8),
          { ...run("challenger", "one", 0.9), targetId: "anthropic-claude" },
        ],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/one identical target/iu);

    expect(() =>
      selectBestTestedCandidate(
        [
          run("baseline", "one", 0.8),
          { ...run("baseline", "two", 0.8), promptHash: "c".repeat(64) },
          run("challenger", "one", 0.9),
          run("challenger", "two", 0.9),
        ],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/more than one prompt hash/iu);

    expect(() =>
      selectBestTestedCandidate(
        [
          run("baseline", "one", 0.8),
          {
            ...run("challenger", "one", 0.9),
            provenance: {
              ...run("challenger", "one", 0.9).provenance,
              backendId: "claude",
            },
          },
        ],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/identical backend, runner, and model provenance/iu);

    const withoutProvenance = { ...run("baseline", "one", 0.8), provenance: undefined };
    expect(() =>
      selectBestTestedCandidate(
        [withoutProvenance, run("challenger", "one", 0.9)] as readonly CandidateEvaluationRun[],
        { baselineCandidateId: "baseline" },
      ),
    ).toThrow(/auditable backend, runner, model, run, timestamp, and observable evidence provenance/iu);

    const runs = [run("baseline", "one", 0.8), run("challenger", "one", 0.9)];
    expect(() =>
      selectBestTestedCandidate(runs, {
        baselineCandidateId: "baseline",
        comparisons: [
          {
            caseId: "one",
            leftCandidateId: "baseline",
            rightCandidateId: "challenger",
            winnerCandidateId: "challenger",
          },
          {
            caseId: "one",
            leftCandidateId: "baseline",
            rightCandidateId: "challenger",
            winnerCandidateId: "challenger",
          },
        ],
      }),
    ).toThrow(/duplicate case\/candidate order/iu);
  });

  it("makes the serialized recommendation self-auditing", () => {
    const evidence = optimizationEvidenceFixture();
    expect(CandidateOptimizationEvidenceSchema.safeParse(evidence).success).toBe(true);

    // Older score-only imports intentionally cannot become promotion evidence:
    // an imported run must still identify the observed executor and rationale.
    expect(
      CandidateOptimizationEvidenceSchema.safeParse({
        ...evidence,
        runs: evidence.runs.map((run) =>
          Object.fromEntries(Object.entries(run).filter(([key]) => key !== "provenance")),
        ),
      }).success,
    ).toBe(false);

    expect(
      CandidateOptimizationEvidenceSchema.safeParse({
        ...evidence,
        report: { ...evidence.report, promoted: false },
      }).success,
    ).toBe(false);
    expect(
      CandidateOptimizationEvidenceSchema.safeParse({
        ...evidence,
        runs: [{ ...evidence.runs[0]!, promptHash: "c".repeat(64) }, ...evidence.runs.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      CandidateOptimizationEvidenceSchema.safeParse({
        ...evidence,
        runs: [
          {
            ...evidence.runs[0]!,
            provenance: {
              ...evidence.runs[0]!.provenance,
              observableEvidence: [],
            },
          },
          ...evidence.runs.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      CandidateOptimizationEvidenceSchema.safeParse({
        ...evidence,
        runs: [
          {
            ...evidence.runs[0]!,
            provenance: {
              ...evidence.runs[0]!.provenance,
              runId: "not-a-uuid",
            },
          },
          ...evidence.runs.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});

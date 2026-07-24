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
  runExternalEvaluation,
  type ExternalEvaluationInvocation,
} from "./external.js";
import {
  advanceVerificationStatus,
  invalidateVerificationAt,
  isVerificationAtLeast,
  VERIFICATION_LADDER,
} from "./verification.js";
import { selectBestTestedCandidate } from "./optimization.js";

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
      blueprint: {
        ...promptPackage.blueprint,
        intent: {
          ...promptPackage.blueprint.intent,
          outputContract: {
            ...promptPackage.blueprint.intent.outputContract,
            schema: undefined,
          },
        },
      },
    };
    const nonJsonReport = evaluateStatic(missingSchema);
    expect(nonJsonReport.passed).toBe(true);

    const jsonWithoutCheck = {
      ...missingSchema,
      blueprint: {
        ...missingSchema.blueprint,
        intent: {
          ...missingSchema.blueprint.intent,
          outputContract: {
            ...missingSchema.blueprint.intent.outputContract,
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
        { mode: "proxy" },
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
      { mode: "proxy", allowExecution: true, repetitions: 1 },
      { id: "fake", evaluate },
    );
    expect(report.passed).toBe(true);
    expect(report.promptPackage.verification).toBe("proxy_evaluated");
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("rejects a verification label without complete passing static evidence", async () => {
    const forged = { ...makePromptPackage(), verification: "statically_validated" as const };
    const evaluate = vi.fn(() => Promise.resolve([]));
    await expect(
      runExternalEvaluation(
        forged,
        { mode: "proxy", allowExecution: true, repetitions: 1 },
        { id: "fake", evaluate },
      ),
    ).rejects.toThrow("complete passing static evidence");
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
        { mode: "proxy", allowExecution: true, repetitions: 1 },
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
        { mode: "proxy", allowExecution: true, repetitions: 1 },
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
      { mode: "proxy", allowExecution: true, repetitions: 3 },
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
      { mode: "live", allowExecution: true, repetitions: 1 },
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
      { mode: "proxy", allowExecution: true, repetitions: 1 },
      { id: "passing", evaluate: passing },
    );
    const failed = await runExternalEvaluation(
      successful.promptPackage,
      { mode: "proxy", allowExecution: true, repetitions: 1 },
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
    caseId,
    repetition: 0,
    score,
    passed: score >= 0.8,
    criticalRegression,
    latencyMs: 10,
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
});

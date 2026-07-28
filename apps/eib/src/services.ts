import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  EvalResultSchema,
  IntentContractSchema,
  PromptSpecSchema,
  PromptPackageSchema,
  SystemClipboardWriter,
  analyzeBrief,
  acceptRecommendedAssumption,
  answerClarification,
  buildPromptSpec,
  createFastDraft,
  BlindedComparisonSchema,
  CandidateOptimizationEvidenceSchema,
  CandidateOptimizationPlanSchema,
  CandidateEvaluationRunSchema,
  createProofReceipt,
  evaluateStatic,
  exportPromptPackage,
  generateDemandSpecificEvaluationSuite,
  generatePromptCandidates,
  readPromptPackage,
  runExternalEvaluation,
  sha256Text,
  selectBestTestedCandidate,
  selectNextQuestion,
  writePromptPackage,
  type BlindedComparison,
  type CandidateEvaluationRun,
  type EvalCase,
  type ExternalEvaluationBackend,
  type PromptPackage,
  type PromptSpec,
  type RenderedTarget,
} from "@eib/core";
import {
  KNOWLEDGE_PACK_VERSION,
  getTargetProfile,
  listTargetProfiles,
  sourceManifest,
  type KnowledgeTargetProfile,
  type refreshKnowledgeUpdates,
} from "@eib/knowledge";
import { z } from "zod";
import {
  createClaudeBackend,
  createCodexBackend,
  createOpenAIBackend,
  type LocalCompilerBackend,
} from "./backends/index.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { resolveAppDataPaths, type AppDataPaths } from "./app-data.js";
import { installProjectRuntime } from "./installer.js";
import { SafePathError, safeWorkspacePath, writeNewText } from "./safe-path.js";
import {
  readUserPreferences,
  writeUserPreferences,
  type UserPreferences,
} from "./preferences.js";
import { executeRuntimeConfirmation, executeRuntimeTransform } from "./runtime-workflow.js";
import { executeKnowledgeCommand } from "./knowledge-workflow.js";
import { compilePrompt } from "./target-renderer.js";
import { CliServiceError, type CliServiceResult } from "./service-contracts.js";
import type { CliCommand, ExecutionBackend } from "./args/types.js";
import { ExitCode as Codes } from "./args/types.js";

/** A reviewed profile makes the first-run preview usable outside a native host. */
const QUICKSTART_FALLBACK_TARGET = "openai-gpt-5.6-codex";

function hasNoRuntimeResolution(data: unknown): boolean {
  if (typeof data !== "object" || data === null || !("resolution" in data)) return false;
  const resolution = data.resolution;
  return (
    typeof resolution === "object" &&
    resolution !== null &&
    "status" in resolution &&
    resolution.status === "needs_input" &&
    (!("runtime" in resolution) || resolution.runtime === undefined)
  );
}

export { CliServiceError, type CliServiceResult } from "./service-contracts.js";

export interface CliServices {
  execute(command: Exclude<CliCommand, { name: "tui" | "help" | "version" }>, signal: AbortSignal): Promise<CliServiceResult>;
  listTargets(): ReadonlyArray<{
    id: string;
    provider: string;
    model: string;
    surface: string;
    availability: string;
  }>;
}

export interface CliServiceOptions {
  /** Injectable for tests and embedding; defaults to the platform app-data path. */
  readonly appDataPaths?: AppDataPaths;
  /**
   * Optional narrow executor injection. It is invoked only after the caller
   * selected a backend and supplied --allow-execution, never at service
   * construction or plan generation time.
   */
  readonly candidateBackendFactory?: (id: ExecutionBackend) => LocalCompilerBackend;
  /** Injectable project root and runtime metadata keep transform deterministic in tests and adapters. */
  readonly workspaceRoot?: string;
  readonly runtimeEnvironment?: Readonly<Record<string, string | undefined>>;
  /**
   * Proposal-only refresh seam. Tests inject this so they never fetch external
   * documentation; production uses the official-source implementation.
   */
  readonly knowledgeRefresh?: typeof refreshKnowledgeUpdates;
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was cancelled.", "AbortError");
}

function portableArtifact(artifact: RenderedTarget): PromptPackage["artifacts"][number] {
  return {
    targetId: artifact.targetId,
    filename: artifact.filename,
    content: artifact.content,
    mimeType: artifact.mimeType,
    warnings: artifact.warnings,
  };
}

function correctionRegressionCase(feedback: string): EvalCase {
  const digest = createHash("sha256").update(feedback).digest("hex").slice(0, 12);
  return {
    id: `user-correction-${digest}`,
    category: "edge",
    input: `Regression case derived from the user's material correction: ${feedback}`,
    expectedProperties: [
      `The result incorporates this correction without weakening the frozen objective: ${feedback}`,
      "All previously explicit constraints and acceptance criteria remain intact.",
    ],
    deterministicChecks: ["non_empty"],
    rubric: [
      "The correction is observably satisfied.",
      "No critical regression is introduced.",
    ],
  };
}

function lineageFor(
  originalIntent: ReturnType<typeof analyzeBrief>,
  resolvedIntent: ReturnType<typeof analyzeBrief>,
): PromptPackage["clarificationLineage"] {
  return originalIntent.unresolvedAmbiguity
    .filter((ambiguity) => !resolvedIntent.unresolvedAmbiguity.some((item) => item.field === ambiguity.field))
    .map((ambiguity) => {
      const assumption = resolvedIntent.assumptions.find((item) =>
        item.startsWith(`${ambiguity.field}:`),
      );
      return {
        question: ambiguity.question,
        answer: assumption?.slice(ambiguity.field.length + 1).trim() ?? "Answered by the user.",
        assumed: assumption !== undefined,
      };
    });
}

function buildPackage(
  originalBrief: string,
  originalIntent: ReturnType<typeof analyzeBrief>,
  prompt: PromptSpec,
  artifacts: readonly RenderedTarget[],
  id = `eib-${randomUUID()}`,
): PromptPackage {
  return PromptPackageSchema.parse({
    version: "1.0.0",
    id,
    createdAt: new Date().toISOString(),
    originalBrief,
    clarificationLineage: lineageFor(originalIntent, prompt.demand),
    prompt,
    artifacts: artifacts.map(portableArtifact),
    warnings: [...new Set(artifacts.flatMap((artifact) => artifact.warnings))],
    evals: generateDemandSpecificEvaluationSuite(prompt).cases,
    results: [],
    knowledge: {
      packVersion: KNOWLEDGE_PACK_VERSION,
      ruleIds: [...new Set(artifacts.flatMap((artifact) => artifact.appliedRuleIds))],
      sourceVersions: Object.fromEntries(
        sourceManifest
          .filter((source) =>
            artifacts.some((artifact) =>
              getTargetProfile(artifact.targetId).sourceIds.includes(source.id),
            ),
          )
          .map((source) => [source.id, source.contentHash]),
      ),
    },
    verification: "compiled",
  });
}

async function latestProjectPackage(candidate: string): Promise<string> {
  if (candidate !== ".eib/package.json") {
    return candidate;
  }
  try {
    await stat(candidate);
    return candidate;
  } catch {
    // Fall through to portable package history discovery.
  }
  const packageRoot = resolve(".eib/packages");
  let entries: string[];
  try {
    entries = await readdir(packageRoot);
  } catch {
    return candidate;
  }
  const directories = await Promise.all(
    entries.map(async (entry) => {
      const path = join(packageRoot, entry);
      const info = await stat(path).catch(() => undefined);
      return info?.isDirectory() ? { path, modified: info.mtimeMs } : undefined;
    }),
  );
  return (
    directories
      .filter((entry): entry is { path: string; modified: number } => entry !== undefined)
      .sort((left, right) => right.modified - left.modified)[0]?.path ?? candidate
  );
}

function packageWriteDestination(packagePath: string, explicit?: string): string | undefined {
  if (explicit !== undefined) {
    return explicit;
  }
  if (basename(packagePath) === "prompt-package.json") {
    return dirname(packagePath);
  }
  return extname(packagePath) === ".json" ? undefined : packagePath;
}

async function readStaticFixtures(path: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliServiceError(`Could not read --fixtures file ${JSON.stringify(path)}: ${reason}`, Codes.usage);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliServiceError(`--fixtures file ${JSON.stringify(path)} must contain valid JSON: ${reason}`, Codes.usage);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliServiceError(`--fixtures file ${JSON.stringify(path)} must contain a JSON object mapping evaluation case IDs to string outputs`, Codes.usage);
  }
  if (Object.values(value).some((output) => typeof output !== "string")) {
    throw new CliServiceError(`--fixtures file ${JSON.stringify(path)} must map every evaluation case ID to a string output`, Codes.usage);
  }
  return value as Record<string, string>;
}

async function readEvidenceFile(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliServiceError(
      `Could not read ${label} file ${JSON.stringify(path)}: ${reason}`,
      Codes.usage,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliServiceError(
      `${label} file ${JSON.stringify(path)} must contain valid JSON: ${reason}`,
      Codes.usage,
    );
  }
}

async function readCandidateEvaluationRuns(path: string): Promise<CandidateEvaluationRun[]> {
  const parsed = CandidateEvaluationRunSchema.array().safeParse(
    await readEvidenceFile(path, "--runs"),
  );
  if (!parsed.success) {
    throw new CliServiceError(
      `--runs file ${JSON.stringify(path)} does not match the candidate-evaluation evidence schema: ${parsed.error.issues[0]?.message ?? "invalid evidence"}`,
      Codes.usage,
    );
  }
  return parsed.data.map((run) => ({
    candidateId: run.candidateId,
    targetId: run.targetId,
    promptHash: run.promptHash,
    caseId: run.caseId,
    repetition: run.repetition,
    score: run.score,
    passed: run.passed,
    criticalRegression: run.criticalRegression,
    latencyMs: run.latencyMs,
    ...(run.inputTokens === undefined ? {} : { inputTokens: run.inputTokens }),
    ...(run.outputTokens === undefined ? {} : { outputTokens: run.outputTokens }),
    ...(run.cost === undefined ? {} : { cost: run.cost }),
    provenance: {
      backendId: run.provenance.backendId,
      runnerId: run.provenance.runnerId,
      modelId: run.provenance.modelId,
      runId: run.provenance.runId,
      evaluatedAt: run.provenance.evaluatedAt,
      observableEvidence: [...run.provenance.observableEvidence],
    },
  }));
}

async function readBlindedComparisons(path: string): Promise<BlindedComparison[]> {
  const parsed = BlindedComparisonSchema.array().safeParse(
    await readEvidenceFile(path, "--comparisons"),
  );
  if (!parsed.success) {
    throw new CliServiceError(
      `--comparisons file ${JSON.stringify(path)} does not match the blinded-comparison schema: ${parsed.error.issues[0]?.message ?? "invalid evidence"}`,
      Codes.usage,
    );
  }
  return parsed.data;
}

function assertCandidateEvidenceScope(
  runs: readonly CandidateEvaluationRun[],
  comparisons: readonly BlindedComparison[],
  candidateIds: readonly string[],
  heldOutCaseIds: readonly string[],
  targetId: string,
  candidateHashes: ReadonlyMap<string, string>,
): void {
  const expectedCandidates = new Set(candidateIds);
  const actualCandidates = new Set(runs.map((run) => run.candidateId));
  const expectedCases = new Set(heldOutCaseIds);
  if (
    actualCandidates.size !== expectedCandidates.size ||
    [...actualCandidates].some((candidateId) => !expectedCandidates.has(candidateId))
  ) {
    throw new CliServiceError(
      "--runs must include evidence for every generated candidate and no unknown candidate IDs.",
      Codes.usage,
      { candidateIds },
    );
  }
  if (runs.some((run) => !expectedCases.has(run.caseId))) {
    throw new CliServiceError(
      "--runs may reference only held-out cases declared by the source package.",
      Codes.usage,
      { heldOutCaseIds },
    );
  }
  if (runs.some((run) => run.targetId !== targetId || run.promptHash !== candidateHashes.get(run.candidateId))) {
    throw new CliServiceError(
      "--runs must name the selected target and the exact hash of each generated candidate.",
      Codes.usage,
      { targetId },
    );
  }
  const actualCases = new Set(runs.map((run) => run.caseId));
  if (
    actualCases.size !== expectedCases.size ||
    [...actualCases].some((caseId) => !expectedCases.has(caseId))
  ) {
    throw new CliServiceError(
      "--runs must cover every held-out case declared by the source package.",
      Codes.usage,
      { heldOutCaseIds },
    );
  }
  if (comparisons.some(
    (comparison) =>
      !expectedCases.has(comparison.caseId) ||
      !expectedCandidates.has(comparison.leftCandidateId) ||
      !expectedCandidates.has(comparison.rightCandidateId) ||
      comparison.leftCandidateId === comparison.rightCandidateId ||
      (comparison.winnerCandidateId !== null && !expectedCandidates.has(comparison.winnerCandidateId)),
  )) {
    throw new CliServiceError(
      "--comparisons may reference only distinct generated candidates and held-out source-package cases.",
      Codes.usage,
      { candidateIds, heldOutCaseIds },
    );
  }
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

function evaluationBackend(
  id: "codex" | "claude",
  signal: AbortSignal,
): ExternalEvaluationBackend {
  const backend = id === "codex" ? createCodexBackend() : createClaudeBackend();
  return {
    id,
    async evaluate(invocation) {
      assertNotAborted(signal);
      const schema = z.array(EvalResultSchema);
      const prompt = [
        "Evaluate each case against the supplied prompt package.",
        "Return exactly one result for every evaluation case and selected prompt target as schema-valid JSON.",
        "Use conclusions and concise pass/fail evidence; do not return hidden chain-of-thought.",
        "Judge the expected properties, rubric, and output contract. Populate observable quality, latency, and token/cost metrics; use null or omit fields that cannot be measured.",
        `Evaluation mode: ${invocation.mode}`,
        `Repetition: ${String(invocation.repetition)}`,
        "Package:",
        JSON.stringify(invocation.promptPackage),
        "Cases:",
        JSON.stringify(invocation.evalCases),
      ].join("\n\n");
      const result = await backend.runStructured({
        prompt,
        schema,
        signal: invocation.signal ?? signal,
      });
      return result.data;
    },
  };
}

const CandidateRunAssessmentSchema = z.object({
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  criticalRegression: z.boolean(),
  evidence: z.array(z.string().min(1)).min(1),
});

/**
 * The optimizer deliberately has a separate execution boundary from `eval`.
 * It runs each immutable candidate against the same frozen case matrix, but
 * never changes the source package or makes a model call merely by generating
 * a plan.  Adding a new native provider therefore means only supplying this
 * narrow structured-output adapter, rather than changing promotion logic.
 */
function candidateExecutionBackend(
  id: ExecutionBackend,
  injected?: (id: ExecutionBackend) => LocalCompilerBackend,
): LocalCompilerBackend {
  if (injected !== undefined) {
    return injected(id);
  }
  switch (id) {
    case "codex":
      return createCodexBackend();
    case "claude":
      return createClaudeBackend();
    case "openai":
      return createOpenAIBackend({ allowExecution: true });
  }
}

function assertCandidateBackendMatchesTarget(
  backend: ExecutionBackend,
  targetId: string,
): KnowledgeTargetProfile {
  const target = getTargetProfile(targetId);
  const compatible =
    (target.provider === "openai" && (backend === "openai" || backend === "codex")) ||
    (target.provider === "anthropic" && backend === "claude");
  if (!compatible) {
    const recommended = target.provider === "openai" ? "openai" : target.provider === "anthropic" ? "claude" : "a native adapter for this provider";
    throw new CliServiceError(
      `Backend ${JSON.stringify(backend)} cannot produce target evidence for ${JSON.stringify(targetId)}. Use ${recommended}.`,
      Codes.usage,
      { backend, targetId, provider: target.provider },
    );
  }
  return target;
}

function candidateExecutionPrompt(
  candidate: { readonly id: string; readonly semanticPrompt: string; readonly promptHash: string },
  evalCase: EvalCase,
  target: KnowledgeTargetProfile,
): string {
  return [
    "You are a constrained prompt-quality execution harness.",
    "Execute the immutable candidate prompt below for the supplied evaluation input as the named target model. Then grade the resulting answer only against the declared expected properties, deterministic checks, and rubric.",
    "Do not use tools, browse, access files, take actions, or claim evidence that is not present in the prompt and case. Do not reveal hidden reasoning. Return only the requested JSON assessment.",
    `Named target: ${target.id} (${target.provider} ${target.model}; ${target.surface}).`,
    `Candidate ID: ${candidate.id}; immutable SHA-256: ${candidate.promptHash}.`,
    "Candidate prompt follows:\n---\n" + candidate.semanticPrompt + "\n---",
    "Held-out evaluation case follows:\n" + JSON.stringify(evalCase),
    "Assessment rules: score is 0 to 1; passed is true only when all material expected properties and deterministic checks pass; criticalRegression is true for a violation of a frozen constraint, exclusion, safety boundary, or output contract. Evidence must be concise, observable, and must not include chain-of-thought.",
  ].join("\n\n");
}

async function executeCandidateRuns(
  candidates: readonly { readonly id: string; readonly semanticPrompt: string; readonly promptHash: string }[],
  heldOutCases: readonly EvalCase[],
  targetId: string,
  backendId: ExecutionBackend,
  repetitions: number,
  signal: AbortSignal,
  injectedBackendFactory?: (id: ExecutionBackend) => LocalCompilerBackend,
): Promise<CandidateEvaluationRun[]> {
  const target = assertCandidateBackendMatchesTarget(backendId, targetId);
  const backend = candidateExecutionBackend(backendId, injectedBackendFactory);
  const runs: CandidateEvaluationRun[] = [];
  for (const candidate of candidates) {
    for (const evalCase of heldOutCases) {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        assertNotAborted(signal);
        const result = await backend.runStructured({
          prompt: candidateExecutionPrompt(candidate, evalCase, target),
          schema: CandidateRunAssessmentSchema,
          model: target.model,
          signal,
        });
        // The core evidence contract deliberately records only measurable
        // verdicts and timing. The untrusted model's prose evidence is never
        // elevated into a promotion criterion or package content.
        runs.push({
          candidateId: candidate.id,
          targetId,
          promptHash: candidate.promptHash,
          caseId: evalCase.id,
          repetition,
          score: result.data.score,
          passed: result.data.passed,
          criticalRegression: result.data.criticalRegression,
          latencyMs: result.durationMs,
          provenance: {
            backendId: result.backend,
            runnerId: `${result.backend}-structured-candidate-runner-v1`,
            modelId: target.model,
            runId: randomUUID(),
            evaluatedAt: new Date().toISOString(),
            observableEvidence: [...result.data.evidence],
          },
        });
      }
    }
  }
  return runs;
}

async function executeNew(
  command: Extract<CliCommand, { name: "new" }>,
  signal: AbortSignal,
  defaultTarget?: string,
): Promise<CliServiceResult> {
  if (command.brief === undefined || !command.brief.trim()) {
    return {
      status: "needs_input",
      message: "Describe what you want to achieve.",
      data: { field: "brief", question: "What do you want the prompt to help achieve?" },
      exitCode: Codes.needsInput,
    };
  }
  const original = analyzeBrief(command.brief, {
    ...(command.outputSchema === undefined ? {} : { outputSchema: command.outputSchema }),
  });
  let intent = original;
  for (const clarification of command.clarifications ?? []) {
    intent = clarification.assumed === true
      ? acceptRecommendedAssumption(intent, clarification.field)
      : answerClarification(intent, clarification.field, clarification.answer);
  }
  if (command.fast) {
    intent = createFastDraft(intent);
  }
  const question = selectNextQuestion(intent);
  if (question !== undefined) {
    return {
      status: "needs_input",
      message: question.question,
      data: { intent, question },
      exitCode: Codes.needsInput,
    };
  }

  assertNotAborted(signal);
  const prompt = buildPromptSpec(intent);
  const targets = command.targets.length === 0
    ? [defaultTarget ?? "openai-gpt-5.6-chatgpt"]
    : command.targets;
  const artifacts = compilePrompt(prompt, targets, signal);
  const promptPackage = buildPackage(command.brief, original, prompt, artifacts);
  const destination =
    command.output ?? resolve(".eib/packages", promptPackage.id);
  assertNotAborted(signal);
  const written = await writePromptPackage(promptPackage, destination);
  return {
    status: "ok",
    message: `Created ${promptPackage.id} for ${targets.join(", ")}.`,
    data: {
      package: promptPackage,
      written,
      defaultTargetApplied: command.targets.length === 0,
      ...(command.targets.length === 0 && defaultTarget !== undefined
        ? { preferredDefaultTargetApplied: defaultTarget }
        : {}),
    },
    exitCode: Codes.success,
  };
}

async function executeImprove(
  command: Extract<CliCommand, { name: "improve" }>,
  signal: AbortSignal,
): Promise<CliServiceResult> {
  const sourcePath = await latestProjectPackage(command.packagePath);
  const source = await readPromptPackage(sourcePath);
  assertNotAborted(signal);
  if (command.feedback === undefined || !command.feedback.trim()) {
    const report = evaluateStatic(source);
    return {
      status: "needs_input",
      message: "Add --feedback with a material correction; the existing package was only evaluated.",
      data: { report },
      exitCode: Codes.needsInput,
    };
  }

  const proposedRegression = correctionRegressionCase(command.feedback);
  const intent = IntentContractSchema.parse(source.prompt.demand);
  intent.preferences = [...intent.preferences, `Improvement feedback: ${command.feedback}`];
  intent.context = [
    ...intent.context,
    {
      id: `improvement-${randomUUID()}`,
      source: "user feedback",
      trust: "user",
      summary: command.feedback,
    },
  ];
  const resolved = command.fast ? createFastDraft(intent) : intent;
  const question = selectNextQuestion(resolved);
  if (question !== undefined) {
    return {
      status: "needs_input",
      message: question.question,
      data: { intent: resolved, question },
      exitCode: Codes.needsInput,
    };
  }

  const prompt = PromptSpecSchema.parse(buildPromptSpec(resolved));
  const targetIds = [...new Set(source.artifacts.map((artifact) => artifact.targetId))];
  const artifacts = compilePrompt(prompt, targetIds, signal);
  const compiled = buildPackage(
    source.originalBrief,
    source.prompt.demand,
    prompt,
    artifacts,
  );
  const next = PromptPackageSchema.parse({
    ...compiled,
    evals: [
      ...generateDemandSpecificEvaluationSuite(prompt).cases,
      proposedRegression,
    ],
  });
  const destination =
    command.output ?? resolve(".eib/packages", next.id);
  const written = await writePromptPackage(next, destination);
  return {
    status: "ok",
    message: `Created improved package ${next.id}; the source package was preserved.`,
    data: { package: next, written, sourcePackageId: source.id },
    exitCode: Codes.success,
  };
}

async function executeOptimize(
  command: Extract<CliCommand, { name: "optimize" }>,
  signal: AbortSignal,
  candidateBackendFactory?: (id: ExecutionBackend) => LocalCompilerBackend,
): Promise<CliServiceResult> {
  const sourcePath = await latestProjectPackage(command.packagePath);
  const source = await readPromptPackage(sourcePath);
  const availableTargets = [...new Set(source.artifacts.map((artifact) => artifact.targetId))];
  const targetId = command.target ?? (availableTargets.length === 1 ? availableTargets[0] : undefined);
  if (targetId === undefined) {
    throw new CliServiceError(
      "This package has several targets; choose exactly one with optimize --target <id>.",
      Codes.usage,
      { availableTargets },
    );
  }
  const target = getTargetProfile(targetId);
  const candidates = generatePromptCandidates(source.prompt, {
    maxCandidates: command.maxCandidates,
    target,
  });
  const baseline = candidates[0];
  if (baseline === undefined) {
    throw new CliServiceError("Could not generate the canonical baseline candidate.");
  }
  const candidateIds = candidates.map((candidate) => candidate.id);
  const candidateHashes = new Map(candidates.map((candidate) => [candidate.id, candidate.promptHash]));
  if (!availableTargets.includes(targetId)) {
    throw new CliServiceError(
      `Target ${JSON.stringify(targetId)} is not compiled in this package.`,
      Codes.usage,
      { availableTargets },
    );
  }
  // Plans always derive their suite from the frozen demand, even when opening
  // an older package that was created before demand-specific suites existed.
  const heldOutCases = generateDemandSpecificEvaluationSuite(source.prompt).cases;
  const heldOutCaseIds = heldOutCases.map((evalCase) => evalCase.id);
  const plan = {
    version: 1 as const,
    sourcePackage: {
      id: source.id,
      verification: source.verification,
    },
    promptSpecId: source.prompt.id,
    targetId,
    baselineCandidateId: baseline.id,
    candidates,
    heldOutCases,
    evidenceContract: {
      runs: "Supply one JSON array entry per generated candidate, held-out case, and repetition. Every candidate must cover the identical case/repetition keys. Or provide a named --backend with explicit --allow-execution to produce this matrix.",
      comparisons: "Optional subjective comparisons must use both candidate orders for each case; a winner must be one of the compared candidates or null.",
      promotion: "A challenger is recommended only when every required run passes, no critical regression is recorded, and its mean score strictly exceeds the configured threshold over baseline.",
      verification: "This command records a recommendation only. It never changes the source package or upgrades its verification status.",
    },
  };

  if (command.runs === undefined && command.backend === undefined) {
    const artifact = CandidateOptimizationPlanSchema.parse({
      ...plan,
      state: "awaiting_evidence",
    });
    const written = command.output === undefined
      ? undefined
      : await writeJsonExclusive(command.output, artifact);
    return {
      status: "needs_input",
      message: "Generated candidate evaluation plan. Import runs with --runs, or explicitly execute every candidate with --backend <name> --allow-execution.",
      data: { ...artifact, written },
      exitCode: Codes.needsInput,
    };
  }

  if (command.backend !== undefined && command.allowExecution !== true) {
    throw new CliServiceError(
      "Candidate execution requires explicit --allow-execution.",
      Codes.usage,
    );
  }
  if (command.backend !== undefined && command.comparisons !== undefined) {
    throw new CliServiceError(
      "Executed candidate runs do not accept imported --comparisons evidence.",
      Codes.usage,
    );
  }
  const repetitions = {
    quick: 1,
    default: 3,
    deep: 5,
  }[command.depth ?? "default"] as 1 | 3 | 5;
  const [runs, comparisons] = await Promise.all([
    command.backend === undefined
      ? readCandidateEvaluationRuns(command.runs!)
      : executeCandidateRuns(
          candidates,
          heldOutCases,
          targetId,
          command.backend,
          repetitions,
          signal,
          candidateBackendFactory,
        ),
    command.comparisons === undefined
      ? Promise.resolve([] as BlindedComparison[])
      : readBlindedComparisons(command.comparisons),
  ]);
  assertCandidateEvidenceScope(
    runs,
    comparisons,
    candidateIds,
    heldOutCaseIds,
    targetId,
    candidateHashes,
  );
  let report;
  try {
    report = selectBestTestedCandidate(runs, {
      baselineCandidateId: baseline.id,
      ...(command.minimumImprovement === undefined
        ? {}
        : { minimumImprovement: command.minimumImprovement }),
      ...(comparisons.length === 0 ? {} : { comparisons }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliServiceError(
      `Candidate evidence did not satisfy the promotion gate: ${reason}`,
      Codes.usage,
    );
  }
  const artifact = CandidateOptimizationEvidenceSchema.parse({
    ...plan,
    state: "evaluated",
    minimumImprovement: command.minimumImprovement ?? 0,
    runs,
    ...(comparisons.length === 0 ? {} : { comparisons }),
    report,
  });
  const written = command.output === undefined
    ? undefined
    : await writeJsonExclusive(command.output, artifact);
  return {
    status: "ok",
    message: report.promoted
      ? `Candidate ${report.selectedCandidateId} cleared the promotion gate; source package remains unchanged.`
      : "No candidate cleared the promotion gate; source package remains unchanged.",
    data: {
      ...artifact,
      written,
      ...(command.backend === undefined
        ? {}
        : {
            execution: {
              backend: command.backend,
              targetId,
              repetitions,
              consented: true,
              method: "target_self_assessment",
              note: "Each candidate/case/repetition was executed sequentially through the named backend. Promotion remains hash- and held-out-suite-bound.",
            },
          }),
    },
    exitCode: Codes.success,
  };
}

export function createCliServices(options: CliServiceOptions = {}): CliServices {
  const appDataPaths = options.appDataPaths ?? resolveAppDataPaths();
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const runtimeEnvironment = options.runtimeEnvironment ?? process.env;
  return {
    listTargets() {
      return listTargetProfiles().map(({ id, provider, model, surface, availability }) => ({
        id,
        provider,
        model,
        surface,
        availability,
      }));
    },
    async execute(command, signal): Promise<CliServiceResult> {
      assertNotAborted(signal);
      switch (command.name) {
        case "install": {
          const installed = await installProjectRuntime(workspaceRoot, { update: command.update });
          return {
            status: "ok",
            message: installed.created.length > 0
              ? `Installed EIB project runtime assets: ${installed.created.join(", ")}.`
              : installed.updated.length > 0
                ? `Updated EIB project runtime assets: ${installed.updated.join(", ")}.`
                : installed.preserved.length > 0
                  ? `EIB preserved locally modified assets: ${installed.preserved.join(", ")}.`
                  : "EIB project runtime assets are already installed.",
            data: installed,
            exitCode: Codes.success,
          };
        }
        case "transform":
          return executeRuntimeTransform(command, signal, {
            root: workspaceRoot,
            environment: runtimeEnvironment,
            compilePrompt,
          });
        case "quickstart": {
          const transform = (explicitTarget?: string) => executeRuntimeTransform({
            name: "transform",
            global: command.global,
            brief: command.brief,
            runtime: "auto",
            deep: command.deep,
            ...(explicitTarget === undefined ? {} : { explicitTarget }),
          }, signal, {
            root: workspaceRoot,
            environment: runtimeEnvironment,
            compilePrompt,
          });
          let result = await transform(command.explicitTarget);
          const usedFallback = command.explicitTarget === undefined && hasNoRuntimeResolution(result.data);
          if (usedFallback) {
            result = await transform(QUICKSTART_FALLBACK_TARGET);
          }
          if (result.status !== "ok") return result;
          const intro = [
            command.usingExample
              ? "This is the built-in read-only project-review example. Re-run `eib quickstart \"your request\"` to use your own request."
              : "This preview was created from your request.",
            ...(usedFallback
              ? [`No runtime was detected, so Quickstart selected the reviewed fallback target \`${QUICKSTART_FALLBACK_TARGET}\`. Use \`--for <target>\` to override it.`]
              : []),
          ].join("\n");
          return {
            ...result,
            message: `Quickstart preview ready. ${result.message}`,
            data: {
              ...(typeof result.data === "object" && result.data !== null ? result.data : {}),
              quickstart: {
                usingExample: command.usingExample,
                ...(usedFallback ? { fallbackTarget: QUICKSTART_FALLBACK_TARGET } : {}),
              },
            },
            ...(result.display === undefined
              ? {}
              : { display: ["# EIB quickstart", "", intro, "No work has started.", "", result.display].join("\n") }),
          };
        }
        case "confirm":
          return executeRuntimeConfirmation(command, signal, workspaceRoot);
        case "new": {
          const { preferences } = await readUserPreferences(appDataPaths.preferencesFile);
          return executeNew(command, signal, preferences.defaultTarget);
        }
        case "improve":
          return executeImprove(command, signal);
        case "optimize":
          return executeOptimize(command, signal, options.candidateBackendFactory);
        case "compile": {
          const sourcePath = await latestProjectPackage(command.packagePath);
          const source = await readPromptPackage(sourcePath);
          const rendered = compilePrompt(source.prompt, command.targets, signal);
          const replaced = new Set(command.targets);
          const promptPackage = PromptPackageSchema.parse({
            ...source,
            artifacts: [
              ...source.artifacts.filter((artifact) => !replaced.has(artifact.targetId)),
              ...rendered.map(portableArtifact),
            ],
            warnings: [
              ...new Set([...source.warnings, ...rendered.flatMap((artifact) => artifact.warnings)]),
            ],
            knowledge: {
              packVersion: KNOWLEDGE_PACK_VERSION,
              ruleIds: [
                ...new Set([
                  ...source.knowledge.ruleIds,
                  ...rendered.flatMap((artifact) => artifact.appliedRuleIds),
                ]),
              ],
              sourceVersions: Object.fromEntries(
                sourceManifest
                  .filter((knowledgeSource) =>
                    [...source.artifacts, ...rendered].some((artifact) =>
                      getTargetProfile(artifact.targetId).sourceIds.includes(knowledgeSource.id),
                    ),
                  )
                  .map((knowledgeSource) => [
                    knowledgeSource.id,
                    knowledgeSource.contentHash,
                  ]),
              ),
            },
            verification: "compiled",
            results: [],
          });
          const destination = packageWriteDestination(sourcePath, command.output);
          const written =
            destination === undefined
              ? undefined
              : await writePromptPackage(promptPackage, destination);
          return {
            status: "ok",
            message:
              written === undefined
                ? "Compilation succeeded; pass --output to persist the updated package."
                : `Compiled ${command.targets.join(", ")} and updated ${written.directory}.`,
            data: { package: promptPackage, rendered, written },
            exitCode: Codes.success,
          };
        }
        case "eval": {
          if (command.mode === "live") {
            if (!command.allowExecution || command.backend !== "openai") {
              throw new CliServiceError(
                "Live target evaluation requires --backend openai and explicit --allow-execution.",
                Codes.usage,
              );
            }
            if (command.fixtures === undefined) {
              throw new CliServiceError(
                "Live target evaluation requires --fixtures for fresh static validation.",
                Codes.usage,
              );
            }
            const sourcePath = await latestProjectPackage(command.packagePath);
            const source = await readPromptPackage(sourcePath);
            const fixtures = await readStaticFixtures(command.fixtures);
            const repetitions = {
              quick: 1,
              default: 3,
              deep: 5,
            }[command.depth] as 1 | 3 | 5;
            const report = await runExternalEvaluation(
              source,
              { mode: "live", staticOutputs: fixtures, allowExecution: true, repetitions, signal },
              createOpenAIBackend({ allowExecution: true }).evaluationBackend,
            );
            const destination = packageWriteDestination(sourcePath);
            const written =
              destination === undefined
                ? undefined
                : await writePromptPackage(report.promptPackage, destination);
            return {
              status: "ok",
              message: `Live target evaluation ${report.passed ? "passed" : "failed"} using OpenAI Responses with a separate judge.`,
              data: { ...report, written },
              exitCode: report.passed ? Codes.success : Codes.error,
            };
          }
          const sourcePath = await latestProjectPackage(command.packagePath);
          const source = await readPromptPackage(sourcePath);
          if (command.mode === "static") {
            const fixtures = command.fixtures === undefined
              ? undefined
              : await readStaticFixtures(command.fixtures);
            const report = evaluateStatic(source, fixtures);
            const destination = packageWriteDestination(sourcePath);
            const written =
              destination === undefined || !report.passed
                ? undefined
                : await writePromptPackage(report.promptPackage, destination);
            return {
              status: "ok",
              message: report.passed
                ? written === undefined
                  ? "Static validation passed."
                  : `Static validation passed and updated ${written.directory}.`
                : "Static validation found blocking issues.",
              data: { ...report, written },
              exitCode: report.passed ? Codes.success : Codes.error,
            };
          }
          if (!command.allowExecution || command.backend === undefined) {
            throw new CliServiceError(
              "External evaluation requires an explicit backend and execution consent.",
              Codes.usage,
            );
          }
          if (command.fixtures === undefined) {
            throw new CliServiceError(
              "External evaluation requires --fixtures for fresh static validation.",
              Codes.usage,
            );
          }
          if (command.backend === "openai") {
            throw new CliServiceError(
              "OpenAI is available only for --mode live; proxy evaluation requires codex or claude.",
              Codes.usage,
            );
          }
          const repetitions = {
            quick: 1,
            default: 3,
            deep: 5,
          }[command.depth] as 1 | 3 | 5;
          const fixtures = await readStaticFixtures(command.fixtures);
          const report = await runExternalEvaluation(
            source,
            { mode: command.mode, staticOutputs: fixtures, allowExecution: true, repetitions, signal },
            evaluationBackend(command.backend, signal),
          );
          const destination = packageWriteDestination(sourcePath);
          const written =
            destination === undefined
              ? undefined
              : await writePromptPackage(report.promptPackage, destination);
          return {
            status: "ok",
            message: `${command.mode} evaluation ${report.passed ? "passed" : "failed"} using ${command.backend}.`,
            data: { ...report, written },
            exitCode: report.passed ? Codes.success : Codes.error,
          };
        }
        case "prove": {
          const sourcePath = await latestProjectPackage(command.packagePath);
          const source = await readPromptPackage(sourcePath);
          const fixtures = await readStaticFixtures(command.fixtures);
          const staticReport = evaluateStatic(source, fixtures);
          const rendered = compilePrompt(
            source.prompt,
            [...new Set(source.artifacts.map((artifact) => artifact.targetId))],
            signal,
          );
          const renderedByTarget = new Map(rendered.map((artifact) => [artifact.targetId, artifact]));
          const artifacts = source.artifacts.map((artifact) => {
            const current = renderedByTarget.get(artifact.targetId);
            const storedContentHash = sha256Text(artifact.content);
            const renderedContentHash = sha256Text(current?.content ?? "");
            return {
              targetId: artifact.targetId,
              filename: artifact.filename,
              storedContentHash,
              renderedContentHash,
              passed:
                current !== undefined &&
                current.filename === artifact.filename &&
                current.mimeType === artifact.mimeType &&
                storedContentHash === renderedContentHash,
            };
          });
          const receipt = createProofReceipt({
            promptPackage: staticReport.promptPackage,
            static: {
              passed: staticReport.passed,
              findings: staticReport.findings.map((finding) => ({
                code: finding.code,
                severity: finding.severity,
              })),
            },
            artifacts,
            observations: staticReport.results.map((result) => ({
              caseId: result.caseId,
              targetId: result.targetId,
              outputHash: sha256Text(fixtures[result.caseId] ?? ""),
              passed: result.passed,
              checks: [{ id: "static_result", passed: result.passed }],
            })),
          });
          let output: string;
          try {
            output = await safeWorkspacePath(workspaceRoot, command.output, "proof receipt path");
            await writeNewText(output, `${JSON.stringify(receipt, null, 2)}\n`, 0o600, "proof receipt path");
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new CliServiceError(
              `Could not write proof receipt: ${reason}`,
              error instanceof SafePathError ? Codes.usage : Codes.error,
            );
          }
          return {
            status: "ok",
            message: receipt.status === "passed"
              ? `Local reproducibility proof passed and wrote ${output}.`
              : `Local reproducibility proof failed; wrote evidence to ${output}.`,
            data: {
              receipt,
              output,
              limitations: [
                "No model or host integration was executed.",
                "This receipt proves only local fixture checks and artifact reproducibility.",
              ],
            },
            exitCode: receipt.status === "passed" ? Codes.success : Codes.error,
          };
        }
        case "export": {
          const sourcePath = await latestProjectPackage(command.packagePath);
          const source = await readPromptPackage(sourcePath);
          const result =
            command.format === "directory"
              ? await exportPromptPackage(source, {
                  format: "directory",
                  destination: command.output!,
                })
              : await exportPromptPackage(source, {
                  format: "clipboard",
                  clipboard: new SystemClipboardWriter(),
                });
          return {
            status: "ok",
            message:
              result.format === "directory"
                ? `Exported package to ${result.written.directory}.`
                : `Copied ${String(result.characters)} characters to the clipboard.`,
            data: result,
            exitCode: Codes.success,
          };
        }
        case "preferences": {
          const loaded = await readUserPreferences(appDataPaths.preferencesFile);
          if (command.action === "show") {
            return {
              status: "ok",
              message: loaded.exists ? "Loaded preferences." : "No preferences file exists; using defaults.",
              data: { preferences: loaded.preferences, exists: loaded.exists, path: appDataPaths.preferencesFile },
              exitCode: Codes.success,
            };
          }
          const next: UserPreferences = command.action === "set"
            ? { ...loaded.preferences, defaultTarget: command.defaultTarget! }
            : { version: 1 };
          if (command.action === "set") {
            try {
              getTargetProfile(command.defaultTarget!);
            } catch (error) {
              throw new CliServiceError(
                `Unknown target ${JSON.stringify(command.defaultTarget)}. Run eib to browse supported target IDs.`,
                Codes.usage,
                error instanceof Error ? { reason: error.message } : undefined,
              );
            }
          }
          const path = await writeUserPreferences(appDataPaths.preferencesFile, next);
          return {
            status: "ok",
            message: command.action === "set" ? "Saved preferences." : "Cleared saved preferences.",
            data: { preferences: next, path },
            exitCode: Codes.success,
          };
        }
        case "doctor": {
          const report = await runDoctor({ signal });
          return {
            status: "ok",
            message: formatDoctorReport(report),
            data: report,
            exitCode: Codes.success,
          };
        }
        case "knowledge":
          return executeKnowledgeCommand(
            command,
            signal,
            workspaceRoot,
            options.knowledgeRefresh === undefined ? {} : { refresh: options.knowledgeRefresh },
          );
      }
    },
  };
}

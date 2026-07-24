import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPromptPackage } from "@eib/core";
import { getRulesForProfile } from "@eib/knowledge";
import { createCliServices } from "./services.js";

describe("CLI services", () => {
  it("uses complete static fixture outputs to record static validation", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-static-fixtures-"));
    const destination = join(root, "package");
    const fixturesPath = join(root, "outputs.json");
    const services = createCliServices();
    const signal = new AbortController().signal;
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a concise Markdown checklist for a product manager.",
          fast: true,
          targets: ["openai-gpt-5.6-api"],
          output: destination,
          outputSchema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
        signal,
      );
      const initial = await readPromptPackage(destination);
      const completeFixtures = Object.fromEntries(initial.evals.map((evalCase) => [
        evalCase.id,
        evalCase.category === "output_schema" ? '{"answer":"ok"}' : "answer",
      ]));

      const structureOnly = await services.execute(
        {
          name: "eval",
          global: { json: true },
          packagePath: destination,
          mode: "static",
          depth: "quick",
          allowExecution: false,
        },
        signal,
      );
      expect(structureOnly.exitCode).toBe(0);
      expect((await readPromptPackage(destination)).verification).toBe("compiled");
      expect((await readPromptPackage(destination)).results).toEqual([]);

      await writeFile(fixturesPath, "[]\n", "utf8");
      await expect(
        services.execute(
          {
            name: "eval",
            global: { json: true },
            packagePath: destination,
            mode: "static",
            depth: "quick",
            fixtures: fixturesPath,
            allowExecution: false,
          },
          signal,
        ),
      ).rejects.toThrow("JSON object");

      await writeFile(fixturesPath, JSON.stringify({ [initial.evals[0]!.id]: 1 }), "utf8");
      await expect(
        services.execute(
          {
            name: "eval",
            global: { json: true },
            packagePath: destination,
            mode: "static",
            depth: "quick",
            fixtures: fixturesPath,
            allowExecution: false,
          },
          signal,
        ),
      ).rejects.toThrow("string output");

      await writeFile(
        fixturesPath,
        `${JSON.stringify({ ...completeFixtures, unknown: "answer" })}\n`,
        "utf8",
      );
      const unknownFixture = await services.execute(
        {
          name: "eval",
          global: { json: true },
          packagePath: destination,
          mode: "static",
          depth: "quick",
          fixtures: fixturesPath,
          allowExecution: false,
        },
        signal,
      );
      expect(unknownFixture.exitCode).toBe(1);

      await writeFile(
        fixturesPath,
        `${JSON.stringify(Object.fromEntries(Object.entries(completeFixtures).slice(1)))}\n`,
        "utf8",
      );
      const incompleteFixtures = await services.execute(
        {
          name: "eval",
          global: { json: true },
          packagePath: destination,
          mode: "static",
          depth: "quick",
          fixtures: fixturesPath,
          allowExecution: false,
        },
        signal,
      );
      expect(incompleteFixtures.exitCode).toBe(1);

      await writeFile(fixturesPath, `${JSON.stringify(completeFixtures)}\n`, "utf8");

      const validated = await services.execute(
        {
          name: "eval",
          global: { json: true },
          packagePath: destination,
          mode: "static",
          depth: "quick",
          fixtures: fixturesPath,
          allowExecution: false,
        },
        signal,
      );
      expect(validated.exitCode).toBe(0);
      const persisted = await readPromptPackage(destination);
      expect(persisted.verification).toBe("statically_validated");
      expect(persisted.results).toHaveLength(initial.evals.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns material improvement feedback into a regression before recompiling", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-services-"));
    const source = join(root, "source");
    const improved = join(root, "improved");
    const services = createCliServices();
    const signal = new AbortController().signal;
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a launch checklist for engineering managers.",
          fast: true,
          targets: ["openai-gpt-5.6-api"],
          output: source,
        },
        signal,
      );
      const originalPackage = await readPromptPackage(source);
      const feedback = "Include an explicit rollback owner for every launch step.";

      await services.execute(
        {
          name: "improve",
          global: { json: true },
          packagePath: source,
          feedback,
          fast: true,
          output: improved,
        },
        signal,
      );

      const improvedPackage = await readPromptPackage(improved);
      expect(
        improvedPackage.evals.some(
          (evalCase) =>
            evalCase.id.startsWith("user-correction-") &&
            evalCase.expectedProperties.join(" ").includes(feedback),
        ),
      ).toBe(true);
      expect(improvedPackage.artifacts[0]?.content).toContain(feedback);
      expect(improvedPackage.prompt.demand.preferences).toContain(`Improvement feedback: ${feedback}`);
      expect((await readFile(join(source, "prompt-package.json"), "utf8"))).toContain(
        originalPackage.id,
      );
      expect(improvedPackage.id).not.toBe(originalPackage.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries an explicit output schema into the prompt and provider request", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-schema-prompt-"));
    const services = createCliServices();
    const outputSchema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    };
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Extract the verified answer from the supplied repository file.",
          fast: true,
          targets: ["openai-gpt-5.6-api"],
          output: root,
          outputSchema,
        },
        new AbortController().signal,
      );

      const promptPackage = await readPromptPackage(root);
      expect(promptPackage.prompt.demand.outputContract).toMatchObject({
        format: "JSON",
        schema: outputSchema,
      });
      const payload = JSON.parse(promptPackage.artifacts[0]!.content) as Record<string, unknown>;
      expect(payload).toHaveProperty("text.format.schema", outputSchema);
      expect(
        promptPackage.evals.find((evalCase) => evalCase.category === "output_schema")
          ?.deterministicChecks,
      ).toContain("valid_json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits distinct, paste-ready surface assets and records only rendered rules", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-surfaces-"));
    const services = createCliServices();
    const targets = [
      "openai-gpt-5.6-chatgpt",
      "anthropic-claude-sonnet-5-chat",
      "openai-gpt-5.6-codex",
      "anthropic-claude-code-sonnet-5",
      "kimi-code-cli",
      "hermes-agent",
    ];
    const expected = new Map([
      ["openai-gpt-5.6-chatgpt", ["prompt.md", "Paste-ready prompt"]],
      ["anthropic-claude-sonnet-5-chat", ["prompt.md", "<task>"]],
      ["openai-gpt-5.6-codex", ["AGENTS.md", "Codex project prompt"]],
      ["anthropic-claude-code-sonnet-5", ["CLAUDE.md", "Claude Code project instructions"]],
      ["kimi-code-cli", [".kimi/instructions.md", "Kimi Code project instructions"]],
      ["hermes-agent", [".hermes/skills/explain-it-better/SKILL.md", "name: explain-it-better-prompt"]],
    ]);
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a concise Markdown checklist for a product manager.",
          fast: true,
          targets,
          output: root,
        },
        new AbortController().signal,
      );
      const promptPackage = await readPromptPackage(root);
      for (const artifact of promptPackage.artifacts) {
        const [filename, marker] = expected.get(artifact.targetId) ?? [];
        expect(artifact.filename, artifact.targetId).toBe(filename);
        expect(artifact.content, artifact.targetId).toContain(marker);
        expect(artifact.content, artifact.targetId).toContain("## Target-specific guidance");
        for (const rule of getRulesForProfile(artifact.targetId)) {
          expect(artifact.content, `${artifact.targetId}/${rule.id}`).toContain(rule.id);
          expect(promptPackage.knowledge.ruleIds).toContain(rule.id);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects live target evaluation before package or backend access", async () => {
    const services = createCliServices();
    await expect(
      services.execute(
        {
          name: "eval",
          global: { json: true },
          packagePath: "/definitely/not/a/package",
          mode: "live",
          depth: "quick",
          backend: "codex",
          allowExecution: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      exitCode: 69,
      details: {
        requestedMode: "live",
        verificationRecorded: false,
      },
    });
  });

  it("creates an evidence-only candidate plan and promotes only a clean held-out improvement", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-optimize-"));
    const packageDirectory = join(root, "package");
    const planPath = join(root, "plan.json");
    const evidencePath = join(root, "evidence.json");
    const runsPath = join(root, "runs.json");
    const services = createCliServices();
    const signal = new AbortController().signal;
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a concise Markdown checklist for a product manager.",
          fast: true,
          targets: ["openai-gpt-5.6-api"],
          output: packageDirectory,
        },
        signal,
      );
      const sourceBefore = await readPromptPackage(packageDirectory);
      const planned = await services.execute(
        {
          name: "optimize",
          global: { json: true },
          packagePath: packageDirectory,
          maxCandidates: 2,
          output: planPath,
        },
        signal,
      );
      expect(planned.exitCode).toBe(3);
      expect(planned.status).toBe("needs_input");
      const plan = JSON.parse(await readFile(planPath, "utf8")) as {
        targetId: string;
        candidates: Array<{ id: string; promptHash: string }>;
      };
      expect(plan.candidates).toHaveLength(2);

      await writeFile(
        runsPath,
        `${JSON.stringify(plan.candidates.map((candidate) => ({
          candidateId: candidate.id,
          targetId: plan.targetId,
          promptHash: candidate.promptHash,
          caseId: sourceBefore.evals[0]!.id,
          repetition: 0,
          score: 0.8,
          passed: true,
          criticalRegression: false,
          latencyMs: 10,
        })))}\n`,
        "utf8",
      );
      await expect(
        services.execute(
          {
            name: "optimize",
            global: { json: true },
            packagePath: packageDirectory,
            maxCandidates: 2,
            runs: runsPath,
          },
          signal,
        ),
      ).rejects.toThrow("cover every held-out case");

      const runs = sourceBefore.evals.flatMap((evalCase) => [
        {
          candidateId: plan.candidates[0]!.id,
          targetId: plan.targetId,
          promptHash: plan.candidates[0]!.promptHash,
          caseId: evalCase.id,
          repetition: 0,
          score: 0.8,
          passed: true,
          criticalRegression: false,
          latencyMs: 10,
        },
        {
          candidateId: plan.candidates[1]!.id,
          targetId: plan.targetId,
          promptHash: plan.candidates[1]!.promptHash,
          caseId: evalCase.id,
          repetition: 0,
          score: 0.9,
          passed: true,
          criticalRegression: false,
          latencyMs: 10,
        },
      ]);
      await writeFile(runsPath, `${JSON.stringify(runs)}\n`, "utf8");
      const optimized = await services.execute(
        {
          name: "optimize",
          global: { json: true },
          packagePath: packageDirectory,
          maxCandidates: 2,
          runs: runsPath,
          minimumImprovement: 0.05,
          output: evidencePath,
        },
        signal,
      );
      expect(optimized.exitCode).toBe(0);
      expect(optimized.message).toContain("cleared the promotion gate");
      const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
        report: { promoted: boolean; selectedCandidateId: string };
      };
      expect(evidence.report).toMatchObject({
        promoted: true,
        selectedCandidateId: plan.candidates[1]!.id,
      });
      const sourceAfter = await readPromptPackage(packageDirectory);
      expect(sourceAfter).toEqual(sourceBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists a validated default target and applies it only when new has no explicit target", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-preferences-service-"));
    const preferencesFile = join(root, "preferences.json");
    const services = createCliServices({
      appDataPaths: {
        preferencesFile,
        knowledgeCacheDirectory: join(root, "knowledge-cache"),
      },
    });
    try {
      await services.execute(
        {
          name: "preferences",
          global: { json: true },
          action: "set",
          defaultTarget: "openai-gpt-5.6-api",
        },
        new AbortController().signal,
      );
      const result = await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a concise Markdown checklist for a product manager.",
          fast: true,
          targets: [],
          output: join(root, "package"),
        },
        new AbortController().signal,
      );
      expect(result.data).toMatchObject({ preferredDefaultTargetApplied: "openai-gpt-5.6-api" });
      expect((await readPromptPackage(join(root, "package"))).artifacts[0]?.targetId)
        .toBe("openai-gpt-5.6-api");
      const shown = await services.execute(
        { name: "preferences", global: { json: true }, action: "show" },
        new AbortController().signal,
      );
      expect(shown.data).toMatchObject({
        exists: true,
        path: preferencesFile,
        preferences: { version: 1, defaultTarget: "openai-gpt-5.6-api" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

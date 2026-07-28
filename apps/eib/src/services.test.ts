import { mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPromptPackage } from "@eib/core";
import { getRulesForProfile } from "@eib/knowledge";
import { createCliServices } from "./services.js";

describe("CLI services", () => {
  it("writes a non-active Claude Opus 5 promotion dossier without making it selectable", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-promotion-dossier-"));
    const output = join(".eib", "knowledge", "promotion-anthropic-claude-opus-5.json");
    try {
      const services = createCliServices({ workspaceRoot: root });
      const result = await services.execute(
        {
          name: "knowledge",
          global: { json: true },
          action: "promote-plan",
          candidate: "anthropic/claude-opus-5",
          sourceIds: [],
        },
        new AbortController().signal,
      );
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain("No profile, rule, capability, or active knowledge-pack file was changed");
      expect(result.data).toMatchObject({
        dossier: {
          activation: "blocked_pending_review",
          candidate: {
            provider: "anthropic",
            model: "claude-opus-5",
            discoveryStatus: "requested_without_catalog_evidence",
          },
          promotion: { status: "pending_human_review" },
        },
      });
      const saved = JSON.parse(await readFile(join(root, output), "utf8")) as {
        candidate: { model: string };
        promotion: { nonActivationGuarantee: string };
      };
      expect(saved.candidate.model).toBe("claude-opus-5");
      expect(saved.promotion.nonActivationGuarantee).toContain("No active knowledge-pack files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes a non-active knowledge refresh proposal without changing the active pack", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-knowledge-refresh-"));
    const output = "review/proposal.json";
    const receivedSourceIds: string[][] = [];
    const services = createCliServices({
      workspaceRoot: root,
      knowledgeRefresh: (options) => {
        receivedSourceIds.push([...(options?.sourceIds ?? [])]);
        return Promise.resolve({
          packVersion: "test-pack",
          refreshedAt: "2026-07-26T10:00:00.000Z",
          activation: "blocked_pending_review",
          sourceCheck: {
            packVersion: "test-pack",
            checkedAt: "2026-07-26T10:00:00.000Z",
            status: "drift_detected",
            checks: [],
          },
          discovery: {
            status: "candidates_detected",
            candidates: [{
              kind: "model",
              provider: "openai",
              model: "gpt-next",
              surface: null,
              sourceId: "openai-codex-docs",
              url: "https://example.test/docs",
              evidenceHash: "a".repeat(64),
              observedAt: "2026-07-26T10:00:00.000Z",
              evidenceExcerpt: "New model gpt-next is available.",
              reviewStatus: "discovered_unreviewed",
            }],
            suppressedObservations: [],
            unavailableSourceIds: [],
          },
          affectedTargetIds: ["openai-gpt-5.6-api"],
          promotion: {
            status: "pending_review",
            reasons: ["Candidate requires profile and rule review."],
          },
        } as never);
      },
    });
    try {
      const result = await services.execute(
        {
          name: "knowledge",
          global: { json: true },
          action: "refresh",
          sourceIds: ["openai-codex-docs"],
          output,
        },
        new AbortController().signal,
      );
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain("non-active knowledge refresh proposal");
      expect(result.message).toContain("Activation remains blocked");
      expect(receivedSourceIds).toEqual([["openai-codex-docs"]]);
      const saved = JSON.parse(await readFile(join(root, output), "utf8")) as { activation: string; discovery: { candidates: unknown[] } };
      expect(saved.activation).toBe("blocked_pending_review");
      expect(saved.discovery.candidates).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a nonzero status for an incomplete refresh proposal", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-knowledge-incomplete-"));
    try {
      const services = createCliServices({
        workspaceRoot: root,
        knowledgeRefresh: () => Promise.resolve({
          packVersion: "test-pack",
          refreshedAt: "2026-07-26T10:00:00.000Z",
          activation: "blocked_pending_review",
          sourceCheck: { packVersion: "test-pack", checkedAt: "2026-07-26T10:00:00.000Z", status: "incomplete", checks: [] },
          discovery: { status: "incomplete", candidates: [], suppressedObservations: [], unavailableSourceIds: ["openai-codex-docs"] },
          affectedTargetIds: [],
          promotion: { status: "pending_review", reasons: ["Source unavailable."] },
        } as never),
      });
      const result = await services.execute(
        {
          name: "knowledge",
          global: { json: true },
          action: "refresh",
          sourceIds: [],
          output: "incomplete-proposal.json",
        },
        new AbortController().signal,
      );
      expect(result.exitCode).toBe(1);
      expect(result.data).toMatchObject({ proposal: { activation: "blocked_pending_review" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects knowledge output paths outside its configured workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-knowledge-root-"));
    const outside = await mkdtemp(join(tmpdir(), "eib-knowledge-outside-"));
    try {
      const services = createCliServices({ workspaceRoot: root });
      await expect(services.execute(
        {
          name: "knowledge",
          global: { json: true },
          action: "promote-plan",
          candidate: "anthropic/claude-opus-5",
          output: join(outside, "opus-5.json"),
          sourceIds: [],
        },
        new AbortController().signal,
      )).rejects.toThrow("Refusing unsafe knowledge output path");
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects default knowledge output redirected through a workspace symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-knowledge-symlink-root-"));
    const outside = await mkdtemp(join(tmpdir(), "eib-knowledge-symlink-outside-"));
    try {
      await symlink(outside, join(root, ".eib"));
      const services = createCliServices({ workspaceRoot: root });
      await expect(services.execute(
        {
          name: "knowledge",
          global: { json: true },
          action: "promote-plan",
          candidate: "anthropic/claude-opus-5",
          sourceIds: [],
        },
        new AbortController().signal,
      )).rejects.toThrow("Refusing symlink in knowledge output path");
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("compiles an architecture request into a runtime-aware preview and requires confirmation", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-runtime-transform-"));
    await writeFile(join(root, "AGENTS.md"), "Run tests before changing source files.\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"runtime-fixture"}\n', "utf8");
    const services = createCliServices({
      workspaceRoot: root,
      runtimeEnvironment: {
        CODEX_THREAD_ID: "fixture-thread",
        CODEX_MODEL: "gpt-5.6",
        CODEX_REASONING_EFFORT: "high",
      },
    });
    try {
      const transformed = await services.execute(
        {
          name: "transform",
          global: { json: true },
          brief: "I want you to review the architecture to be sure that everything is perfectly wired, what are the next steps to update the project",
          runtime: "auto",
          deep: false,
        },
        new AbortController().signal,
      );
      expect(transformed.exitCode).toBe(0);
      expect(transformed.data).toMatchObject({
        target: { id: "openai-gpt-5.6-codex" },
        targetSelection: "runtime",
        runtime: { reasoningMode: "high" },
      });
      expect(transformed.display).toContain("architecture review and prioritized next steps");
      expect(transformed.display).toContain("AGENTS.md");
      const token = (transformed.data as { runToken: string }).runToken;

      const confirmed = await services.execute(
        { name: "confirm", global: { json: true }, token },
        new AbortController().signal,
      );
      expect(confirmed.exitCode).toBe(0);
      expect(confirmed.display).toContain("EIB execution contract");
      expect(confirmed.data).toMatchObject({ runToken: token });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("guides a first run through a preview without bypassing confirmation", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-runtime-quickstart-"));
    await writeFile(join(root, "package.json"), '{"name":"runtime-fixture"}\n', "utf8");
    const services = createCliServices({
      workspaceRoot: root,
      runtimeEnvironment: { CODEX_THREAD_ID: "fixture-thread", CODEX_MODEL: "gpt-5.6" },
    });
    try {
      const preview = await services.execute(
        {
          name: "quickstart",
          global: { json: false },
          brief: "Review this project's architecture and deliver a prioritized Markdown list of concrete next steps for a maintainer.",
          deep: false,
          usingExample: true,
        },
        new AbortController().signal,
      );
      expect(preview).toMatchObject({
        status: "ok",
        data: { quickstart: { usingExample: true }, target: { id: "openai-gpt-5.6-codex" } },
      });
      expect(preview.display).toContain("# EIB quickstart");
      expect(preview.display).toContain("No work has started.");
      expect(preview.display).toMatch(/eib confirm [a-f0-9-]+/u);
      expect(preview.display).not.toContain("# EIB confirmed handoff");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a transparent reviewed fallback when quickstart has no runtime metadata", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-runtime-quickstart-fallback-"));
    await writeFile(join(root, "package.json"), '{"name":"runtime-fixture"}\n', "utf8");
    const services = createCliServices({ workspaceRoot: root, runtimeEnvironment: {} });
    try {
      const preview = await services.execute(
        {
          name: "quickstart",
          global: { json: false },
          brief: "Review this project's architecture and deliver a prioritized Markdown list of concrete next steps for a maintainer.",
          deep: false,
          usingExample: true,
        },
        new AbortController().signal,
      );
      expect(preview).toMatchObject({
        status: "ok",
        data: {
          target: { id: "openai-gpt-5.6-codex" },
          quickstart: { fallbackTarget: "openai-gpt-5.6-codex" },
        },
      });
      expect(preview.display).toContain("No runtime was detected");
      expect(preview.display).toContain("eib confirm");
      expect(preview.display).not.toContain("# EIB confirmed handoff");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires a fresh transform when selected context changes before confirmation", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-runtime-stale-"));
    await writeFile(join(root, "AGENTS.md"), "Run tests before changing source files.\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"runtime-fixture"}\n', "utf8");
    const services = createCliServices({
      workspaceRoot: root,
      runtimeEnvironment: { CODEX_THREAD_ID: "fixture-thread", CODEX_MODEL: "gpt-5.6" },
    });
    try {
      const transformed = await services.execute(
        {
          name: "transform",
          global: { json: true },
          brief: "Review the project architecture and propose changes.",
          runtime: "auto",
          deep: false,
        },
        new AbortController().signal,
      );
      const token = (transformed.data as { runToken: string }).runToken;
      await writeFile(join(root, "AGENTS.md"), "Do not change source files.\n", "utf8");
      const confirmation = await services.execute(
        { name: "confirm", global: { json: true }, token },
        new AbortController().signal,
      );
      expect(confirmation).toMatchObject({
        status: "needs_input",
        exitCode: 3,
        data: { retransformRequired: true },
      });
      expect(confirmation.message).toContain("selected context changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it("writes a redacted local reproducibility receipt without mutating the source package", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-proof-"));
    const destination = join(root, "package");
    const fixturesPath = join(root, "outputs.json");
    const services = createCliServices({ workspaceRoot: root });
    const signal = new AbortController().signal;
    try {
      await services.execute(
        {
          name: "new",
          global: { json: true },
          brief: "Write a concise JSON launch checklist.",
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
      const sourceBefore = await readFile(join(destination, "prompt-package.json"), "utf8");
      const source = await readPromptPackage(destination);
      const fixtures = Object.fromEntries(source.evals.map((evalCase) => [
        evalCase.id,
        evalCase.category === "output_schema" ? '{"answer":"ok"}' : "answer",
      ]));
      await writeFile(fixturesPath, JSON.stringify(fixtures), "utf8");

      const proved = await services.execute(
        {
          name: "prove",
          global: { json: true },
          packagePath: destination,
          fixtures: fixturesPath,
          output: ".eib/proofs/receipt.json",
        },
        signal,
      );
      expect(proved.exitCode).toBe(0);
      expect(proved.data).toMatchObject({ receipt: { status: "passed" } });
      const receiptText = await readFile(join(root, ".eib/proofs/receipt.json"), "utf8");
      expect(receiptText).toContain('"status": "passed"');
      expect(receiptText).not.toContain('"answer":"ok"');
      expect(await readFile(join(destination, "prompt-package.json"), "utf8")).toBe(sourceBefore);

      const failedFixtures = { ...fixtures, [source.evals.find((evalCase) => evalCase.category === "output_schema")!.id]: "not-json" };
      await writeFile(fixturesPath, JSON.stringify(failedFixtures), "utf8");
      const failed = await services.execute(
        {
          name: "prove",
          global: { json: true },
          packagePath: destination,
          fixtures: fixturesPath,
          output: ".eib/proofs/failed.json",
        },
        signal,
      );
      expect(failed.exitCode).toBe(1);
      expect(failed.data).toMatchObject({ receipt: { status: "failed" } });

      await expect(
        services.execute(
          {
            name: "prove",
            global: { json: true },
            packagePath: destination,
            fixtures: fixturesPath,
            output: "../outside.json",
          },
          signal,
        ),
      ).rejects.toThrow("outside workspace");
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

  it("rejects a non-native backend before live package access", async () => {
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
      exitCode: 2,
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
      const importedProvenance = {
        backendId: "fixture-import",
        runnerId: "fixture-import-v1",
        modelId: "fixture-model",
        runId: "00000000-0000-4000-8000-000000000001",
        evaluatedAt: "2026-01-01T00:00:00.000Z",
        observableEvidence: ["Fixture result was recorded."],
      };

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
          provenance: importedProvenance,
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
          provenance: importedProvenance,
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
          provenance: importedProvenance,
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

  it("executes every candidate on the identical demand-derived suite only after explicit consent", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-optimize-execute-"));
    const packageDirectory = join(root, "package");
    const invocations: string[] = [];
    const services = createCliServices({
      candidateBackendFactory: () => ({
        id: "codex",
        role: "compiler",
        executable: "test-executor",
        async runStructured(request) {
          await Promise.resolve();
          invocations.push(request.prompt);
          return {
            backend: "codex",
            durationMs: 7,
            data: request.schema.parse({
              score: 0.8,
              passed: true,
              criticalRegression: false,
              evidence: ["All declared properties were addressed."],
            }),
          };
        },
      }),
    });
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
        new AbortController().signal,
      );
      const source = await readPromptPackage(packageDirectory);
      const result = await services.execute(
        {
          name: "optimize",
          global: { json: true },
          packagePath: packageDirectory,
          maxCandidates: 2,
          target: "openai-gpt-5.6-api",
          backend: "openai",
          allowExecution: true,
          depth: "quick",
        },
        new AbortController().signal,
      );
      expect(result.exitCode).toBe(0);
      expect(invocations).toHaveLength(source.evals.length * 2);
      expect(invocations.every((prompt) => prompt.includes("Held-out evaluation case follows"))).toBe(true);
      expect(result.data).toMatchObject({
        execution: {
          backend: "openai",
          targetId: "openai-gpt-5.6-api",
          repetitions: 1,
          consented: true,
        },
      });
      const runs =
        typeof result.data === "object" && result.data !== null && "runs" in result.data
          ? result.data.runs
          : undefined;
      if (!Array.isArray(runs)) {
        throw new Error("The automatic candidate-run result must expose its recorded runs.");
      }
      expect(runs.some((run: unknown) =>
        typeof run === "object" &&
        run !== null &&
        "targetId" in run &&
        "latencyMs" in run &&
        run.targetId === "openai-gpt-5.6-api" &&
        run.latencyMs === 7,
      )).toBe(true);
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

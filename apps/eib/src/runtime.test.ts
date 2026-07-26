import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { targetProfiles } from "@eib/knowledge";
import { detectRuntime, resolveRuntimeTarget, runtimeTargetCapabilities } from "./runtime.js";

describe("runtime target resolution", () => {
  it("does not apply a Codex profile fallback when the exact model is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-codex-"));
    await writeFile(root + "/.eibrc.json", JSON.stringify({ version: 1, defaultTarget: "openai-gpt-5.6-codex" }));
    const runtime = detectRuntime({ CODEX_THREAD_ID: "thread" });
    expect(runtime).toMatchObject({
      adapterId: "codex",
      provider: "openai",
      model: "<unknown>",
      surface: "coding_cli",
      detectionSource: "native_environment_without_exact_model",
    });
    const resolved = await resolveRuntimeTarget({ root, environment: { CODEX_THREAD_ID: "thread" } });
    expect(resolved.status).toBe("needs_input");
    expect(resolved.message).toContain("exact active model is unavailable");
  });

  it("does not apply a Claude profile fallback when the exact model is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-claude-missing-model-"));
    await writeFile(root + "/.eibrc.json", JSON.stringify({ version: 1, defaultTarget: "anthropic-claude-code-sonnet-5" }));
    await expect(resolveRuntimeTarget({ root, environment: { CLAUDECODE: "1" } })).resolves.toMatchObject({
      status: "needs_input",
      runtime: {
        model: "<unknown>",
        detectionSource: "native_environment_without_exact_model",
      },
    });
  });

  it("does not borrow the sole matching surface profile for an unreviewed exact model", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-claude-unreviewed-model-"));
    const resolved = await resolveRuntimeTarget({
      root,
      environment: {
        CLAUDECODE: "1",
        CLAUDE_MODEL: "claude-opus-5",
      },
    });
    expect(resolved.status).toBe("needs_input");
    expect(resolved.message).toContain("claude-opus-5");
  });

  it("uses an exact Claude Code runtime model and retains reasoning metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-claude-"));
    await expect(
      resolveRuntimeTarget({
        root,
        environment: {
          CLAUDECODE: "1",
          CLAUDE_MODEL: "claude-sonnet-5",
          CLAUDE_REASONING_MODE: "high",
        },
      }),
    ).resolves.toMatchObject({
      status: "resolved",
      target: { id: "anthropic-claude-code-sonnet-5" },
      runtime: { reasoningMode: "high" },
    });
  });

  it("requires an explicit target for an unknown runtime and honors a project fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-fallback-"));
    await expect(resolveRuntimeTarget({ root, environment: {} })).resolves.toMatchObject({
      status: "needs_input",
    });
    await writeFile(root + "/.eibrc.json", JSON.stringify({ version: 1, defaultTarget: "kimi-k3-api" }));
    await expect(resolveRuntimeTarget({ root, environment: {} })).resolves.toMatchObject({
      status: "resolved",
      target: { id: "kimi-k3-api" },
      selectionSource: "project_default",
    });
  });

  it("resolves every reviewed profile through the generic adapter contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-profiles-"));
    for (const profile of targetProfiles) {
      const resolved = await resolveRuntimeTarget({
        root,
        environment: {
          EIB_RUNTIME_PROVIDER: profile.provider,
          EIB_RUNTIME_MODEL: profile.model,
          EIB_RUNTIME_SURFACE: profile.surface,
          EIB_RUNTIME_REASONING: profile.reasoning.defaultMode,
          EIB_RUNTIME_TOOLS: profile.supports.tools ? "filesystem,terminal" : "",
        },
      });
      expect(resolved, profile.id).toMatchObject({ status: "resolved", target: { id: profile.id } });
    }
    expect(runtimeTargetCapabilities()).toHaveLength(targetProfiles.length);
    expect(runtimeTargetCapabilities().find((entry) => entry.targetId === "openai-gpt-5.6-codex"))
      .toMatchObject({ integration: "native_skill" });
    for (const profile of targetProfiles.filter((entry) => entry.provider === "anthropic" && entry.surface === "coding_cli")) {
      expect(runtimeTargetCapabilities().find((entry) => entry.targetId === profile.id))
        .toMatchObject({ integration: "native_slash_command" });
    }
  });

  it("requires an exact model from an incomplete generic adapter contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-generic-incomplete-"));
    await expect(resolveRuntimeTarget({
      root,
      environment: {
        EIB_RUNTIME_PROVIDER: "anthropic",
        EIB_RUNTIME_SURFACE: "coding_cli",
      },
    })).resolves.toMatchObject({
      status: "needs_input",
      runtime: {
        adapterId: "generic-cli",
        model: "<unknown>",
      },
    });
  });
});

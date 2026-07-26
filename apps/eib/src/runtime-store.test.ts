import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_RUN_TTL_MS,
  confirmRuntimeRun,
  createRuntimeRun,
} from "./runtime-store.js";
import type { StaleRuntimeRunError } from "./runtime-store.js";

const fingerprint = "a".repeat(64);
const freshness = {
  workspaceHead: "b".repeat(40),
  contextFingerprint: fingerprint,
  knowledgeFingerprint: "c".repeat(64),
};

describe("runtime confirmation records", () => {
  it("expires run tokens and rejects changed workspace/context/knowledge fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-runtime-store-"));
    const now = new Date("2026-07-26T10:00:00.000Z");
    try {
      const run = await createRuntimeRun({
        root,
        rawRequest: "Review the project.",
        targetId: "openai-gpt-5.6-codex",
        context: {
          mode: "scoped",
          root,
          repository: { head: freshness.workspaceHead, status: "clean", changedEntries: 0 },
          entries: [],
        },
        assumptions: [],
        handoff: "Do the review.",
        freshness,
        now,
      });
      await expect(confirmRuntimeRun(root, run.token, {
        ...freshness,
        contextFingerprint: "d".repeat(64),
      }, now)).rejects.toEqual(expect.objectContaining<Partial<StaleRuntimeRunError>>({
        reasons: ["selected context changed"],
      }));
      await expect(confirmRuntimeRun(
        root,
        run.token,
        freshness,
        new Date(now.getTime() + RUNTIME_RUN_TTL_MS),
      )).rejects.toEqual(expect.objectContaining<Partial<StaleRuntimeRunError>>({
        reasons: ["confirmation window expired"],
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

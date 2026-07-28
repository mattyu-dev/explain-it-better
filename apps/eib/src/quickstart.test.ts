import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "./cli.js";
import { createCliServices } from "./services.js";

function capture(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = "";
  let error = "";
  return {
    io: {
      stdout: {
        isTTY: false,
        write(value: string | Uint8Array) {
          out += String(value);
          return true;
        },
      },
      stderr: {
        write(value: string | Uint8Array) {
          error += String(value);
          return true;
        },
      },
    },
    stdout: () => out,
    stderr: () => error,
  };
}

describe("first-time CLI quickstart", () => {
  it("turns a plain request into a reviewable brief and a confirmed handoff", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-quickstart-"));
    await writeFile(join(root, "AGENTS.md"), "Run tests before changing source files.\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"quickstart-fixture"}\n', "utf8");
    const services = createCliServices({
      workspaceRoot: root,
      runtimeEnvironment: {
        CODEX_THREAD_ID: "quickstart-thread",
        CODEX_MODEL: "gpt-5.6",
      },
    });
    const prepared = capture();

    try {
      await expect(
        runCli(
          [
            "transform",
            "I want you to review the architecture to be sure that everything is perfectly wired, what are the next steps to update the project",
            "--runtime",
            "auto",
          ],
          prepared.io,
          services,
        ),
      ).resolves.toBe(0);

      const preview = prepared.stdout();
      expect(prepared.stderr()).toBe("");
      expect(preview).toContain("Compiled a scoped runtime brief");
      expect(preview).toContain("Target: `openai-gpt-5.6-codex`");
      expect(preview).toContain("## Visible assumptions");
      expect(preview).toContain("## Context manifest");
      const token = preview.match(/eib confirm ([0-9a-f-]{36})/u)?.[1];
      expect(token, "quickstart preview must provide a confirmation command").toBeDefined();

      const confirmed = capture();
      await expect(runCli(["confirm", token ?? ""], confirmed.io, services)).resolves.toBe(0);
      expect(confirmed.stderr()).toBe("");
      expect(confirmed.stdout()).toContain("# EIB confirmed handoff");
      expect(confirmed.stdout()).toContain("# EIB execution contract");
      expect(confirmed.stdout()).toContain("AGENTS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

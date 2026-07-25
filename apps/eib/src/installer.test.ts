import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installProjectRuntime } from "./installer.js";

describe("project runtime installer", () => {
  it("installs idempotent Codex and Claude assets without touching user instruction files", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-"));
    await writeFile(join(root, "AGENTS.md"), "User-owned instructions\n");
    const installed = await installProjectRuntime(root);
    expect(installed.created).toEqual(expect.arrayContaining([
      ".eibrc.json",
      ".codex/skills/explain-it-better/SKILL.md",
      ".claude/commands/eib.md",
      ".claude/commands/eib-deep.md",
    ]));
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe("User-owned instructions\n");
    await expect(installProjectRuntime(root)).resolves.toMatchObject({ created: [] });
  });

  it("refuses to overwrite a non-EIB command asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-conflict-"));
    const command = join(root, ".claude", "commands", "eib.md");
    await mkdir(join(root, ".claude", "commands"), { recursive: true });
    await writeFile(command, "User command\n");
    await expect(installProjectRuntime(root)).rejects.toThrow("unowned install asset");
  });
});

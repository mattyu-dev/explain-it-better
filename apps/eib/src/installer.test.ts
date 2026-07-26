import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installProjectRuntime } from "./installer.js";

describe("project runtime installer", () => {
  it("installs portable skills plus optional power commands without touching user instruction files", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-"));
    await writeFile(join(root, "AGENTS.md"), "User-owned instructions\n");
    const installed = await installProjectRuntime(root);
    expect(installed.created).toEqual(expect.arrayContaining([
      ".eibrc.json",
      ".agents/skills/explain-it-better/SKILL.md",
      ".codex/skills/explain-it-better/SKILL.md",
      ".claude/skills/explain-it-better/SKILL.md",
      ".claude/commands/eib.md",
      ".claude/commands/eib-deep.md",
    ]));
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe("User-owned instructions\n");
    const portableSkill = await readFile(join(root, ".agents", "skills", "explain-it-better", "SKILL.md"), "utf8");
    expect(portableSkill).toContain("No work has started");
    expect(portableSkill).not.toMatch(/`eib(?:-mcp)?\b|eib_prepare|eib_confirm/u);
    await expect(installProjectRuntime(root)).resolves.toMatchObject({ created: [] });
  });

  it("fingerprints assets, updates verified EIB assets, and preserves locally edited EIB assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-update-"));
    await installProjectRuntime(root);
    const skillPath = join(root, ".codex", "skills", "explain-it-better", "SKILL.md");
    const commandPath = join(root, ".claude", "commands", "eib.md");
    const installedSkill = await readFile(skillPath, "utf8");
    expect(installedSkill).toMatch(/EIB-ASSET: codex-skill; VERSION: 3; SHA256: [a-f0-9]{64}/);

    const alteredBody = installedSkill.replace("# Explain It Better", "# Explain It Better (old generated asset)");
    const withoutHash = alteredBody.replace(/SHA256: [a-f0-9]{64}/, "SHA256: pending");
    const body = withoutHash
      .replace(/# Managed by Explain It Better\.\n/, "")
      .replace(/# EIB-ASSET: codex-skill; VERSION: 3; SHA256: pending\n/, "");
    const verifiedOldAsset = withoutHash.replace(
      "SHA256: pending",
      `SHA256: ${createHash("sha256").update(body).digest("hex")}`,
    );
    await writeFile(skillPath, verifiedOldAsset);
    const locallyEdited = `${await readFile(commandPath, "utf8")}\nLocal change\n`;
    await writeFile(commandPath, locallyEdited);

    const refreshed = await installProjectRuntime(root, { update: true });
    expect(refreshed.updated).toContain(".codex/skills/explain-it-better/SKILL.md");
    expect(refreshed.preserved).toContain(".claude/commands/eib.md");
    await expect(readFile(skillPath, "utf8")).resolves.toBe(installedSkill);
    await expect(readFile(commandPath, "utf8")).resolves.toBe(locallyEdited);
  });

  it("refuses to overwrite a non-EIB command asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-conflict-"));
    const command = join(root, ".claude", "commands", "eib.md");
    await mkdir(join(root, ".claude", "commands"), { recursive: true });
    await writeFile(command, "User command\n");
    await expect(installProjectRuntime(root)).rejects.toThrow("unowned install asset");
  });

  it("rejects symlinked managed directories before any install asset is created", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-install-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "eib-install-outside-"));
    await symlink(outside, join(root, ".codex"));
    await expect(installProjectRuntime(root)).rejects.toThrow("Refusing symlink in installation path");
    await expect(readdir(outside)).resolves.toEqual([]);
    await expect(readFile(join(root, ".eibrc.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

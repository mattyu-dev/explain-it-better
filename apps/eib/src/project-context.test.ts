import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProjectContext } from "./project-context.js";

describe("project context discovery", () => {
  it("keeps scoped context visible and only inlines project instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-context-scoped-"));
    await writeFile(join(root, "AGENTS.md"), "Use tests before making changes.\n");
    await writeFile(join(root, "README.md"), "Architecture notes.\n");
    await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
    const manifest = await discoverProjectContext({
      root,
      brief: "Review the architecture and propose changes.",
      deep: false,
    });
    expect(manifest.mode).toBe("scoped");
    expect(manifest.entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({
      included: true,
      inlineContent: "Use tests before making changes.\n",
    });
    expect(manifest.entries.find((entry) => entry.path === "README.md")).toMatchObject({
      included: true,
    });
    expect(manifest.entries.find((entry) => entry.path === "README.md")?.inlineContent).toBeUndefined();
  });

  it("deep mode records every tracked candidate while excluding secret and binary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "eib-context-deep-"));
    await writeFile(join(root, "AGENTS.md"), "Keep changes safe.\n");
    await writeFile(join(root, "src.ts"), "export const answer = 42;\n");
    await writeFile(join(root, ".env"), "API_KEY='not-for-context'\n");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    const manifest = await discoverProjectContext({
      root,
      brief: "Deep architecture review",
      deep: true,
      tracked: ["AGENTS.md", "src.ts", ".env", "binary.dat"],
    });
    expect(manifest.entries.find((entry) => entry.path === "src.ts")).toMatchObject({ included: true });
    expect(manifest.entries.find((entry) => entry.path === ".env")).toMatchObject({
      included: false,
      reason: "secret_named_path",
    });
    expect(manifest.entries.find((entry) => entry.path === "binary.dat")).toMatchObject({
      included: false,
      reason: "binary_or_invalid_utf8",
    });
  });
});

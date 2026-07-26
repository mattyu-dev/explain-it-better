import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatPromptPackageForClipboard,
} from "./clipboard.js";
import { exportPromptPackage } from "./export.js";
import { readPromptPackage, writePromptPackage } from "./storage.js";
import { makePromptPackage } from "./test-fixtures.js";

class MemoryClipboardWriter {
  value = "";

  writeText(text: string): Promise<void> {
    this.value = text;
    return Promise.resolve();
  }
}

async function temporaryDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "eib-package-test-")));
}

interface TestManifest {
  readonly version: 1;
  readonly packageId: string;
  readonly files: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function parseTestManifest(content: string): TestManifest {
  const value: unknown = JSON.parse(content);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.packageId !== "string" ||
    !isStringRecord(value.files)
  ) {
    throw new Error("Expected a package manifest fixture.");
  }
  return { version: 1, packageId: value.packageId, files: value.files };
}

describe("portable package persistence", () => {
  it("writes and reads the canonical package and portable evidence files", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "export");
    const promptPackage = makePromptPackage();
    const written = await writePromptPackage(promptPackage, destination);
    expect(written.files).toContain("prompt.json");
    expect(written.files).toContain("evals.jsonl");
    expect(written.files).toContain("provenance.json");
    expect(written.files).toContain("input-bindings.json");
    expect(written.files).toContain("verification-report.md");
    expect(written.files).toContain("artifacts/openai-gpt/prompt.md");
    await expect(readPromptPackage(destination)).resolves.toEqual(promptPackage);
    expect(await readFile(join(destination, "verification-report.md"), "utf8")).toContain(
      "does not claim universal prompt optimality",
    );
  });

  it("refuses non-empty unowned destinations and modified managed files", async () => {
    const root = await temporaryDirectory();
    const unowned = join(root, "unowned");
    await mkdir(unowned);
    await writeFile(join(unowned, "note.txt"), "mine");
    await expect(writePromptPackage(makePromptPackage(), unowned)).rejects.toThrow(
      "no EIB ownership manifest",
    );

    const managed = join(root, "managed");
    await writePromptPackage(makePromptPackage(), managed);
    await writeFile(join(managed, "prompt.json"), "user edit");
    await expect(writePromptPackage(makePromptPackage(), managed)).rejects.toThrow(
      "modified package files",
    );
  });

  it("rejects malformed or case-colliding ownership records", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "managed");
    await writePromptPackage(makePromptPackage(), destination);
    await writeFile(
      join(destination, ".eib-package-manifest.json"),
      JSON.stringify({
        version: 1,
        packageId: "example-package",
        files: {
          "prompt-package.json": "0".repeat(64),
          "PROMPT-PACKAGE.JSON": "1".repeat(64),
        },
      }),
    );

    await expect(
      writePromptPackage(makePromptPackage(), destination),
    ).rejects.toThrow("Invalid package ownership record");
  });

  it("removes only unmodified stale managed artifacts", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "managed");
    const original = makePromptPackage();
    await writePromptPackage(original, destination);
    const oldArtifact = join(destination, "artifacts", "openai-gpt", "prompt.md");

    const renamed = makePromptPackage();
    renamed.artifacts[0] = {
      ...renamed.artifacts[0]!,
      filename: "renamed.md",
    };
    await writePromptPackage(renamed, destination);
    await expect(readFile(oldArtifact, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(destination, "artifacts", "openai-gpt", "renamed.md"), "utf8"),
    ).resolves.toContain("cite supplied");

    const renamedArtifact = join(
      destination,
      "artifacts",
      "openai-gpt",
      "renamed.md",
    );
    await writeFile(renamedArtifact, "user edit");
    await expect(writePromptPackage(original, destination)).rejects.toThrow(
      "modified package files",
    );
    await expect(readFile(renamedArtifact, "utf8")).resolves.toBe("user edit");
  });

  it("recovers an interrupted multi-file update before accepting the next write", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "managed");
    const staged = join(root, "staged");
    const original = makePromptPackage();
    await writePromptPackage(original, destination);
    const previousManifest = parseTestManifest(
      await readFile(join(destination, ".eib-package-manifest.json"), "utf8"),
    );

    const updated = makePromptPackage();
    updated.artifacts[0] = {
      ...updated.artifacts[0]!,
      filename: "recovered.md",
      content: "Recovered after an interrupted update.\n",
    };
    await writePromptPackage(updated, staged);
    const manifest = parseTestManifest(
      await readFile(join(staged, ".eib-package-manifest.json"), "utf8"),
    );
    const files = Object.fromEntries(
      await Promise.all(
        Object.keys(manifest.files).map(async (relativePath): Promise<readonly [string, string]> => [
          relativePath,
          await readFile(join(staged, ...relativePath.split("/")), "utf8"),
        ]),
      ),
    );

    // Simulate a process dying after it has recorded the transaction and
    // written only some new files, while the old manifest remains in place.
    await writeFile(join(destination, "prompt-package.json"), files["prompt-package.json"]!);
    await mkdir(join(destination, "artifacts", "openai-gpt"), { recursive: true });
    await writeFile(
      join(destination, "artifacts", "openai-gpt", "recovered.md"),
      files["artifacts/openai-gpt/recovered.md"]!,
    );
    await writeFile(
      join(destination, ".eib-package-update.json"),
      JSON.stringify({
        version: 1,
        packageId: updated.id,
        previousManifest,
        files,
        staleManagedFiles: {
          "artifacts/openai-gpt/prompt.md": previousManifest.files["artifacts/openai-gpt/prompt.md"],
        },
        manifest,
      }),
    );

    await writePromptPackage(updated, destination);

    await expect(readPromptPackage(destination)).resolves.toEqual(updated);
    await expect(
      readFile(join(destination, "artifacts", "openai-gpt", "prompt.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(destination, ".eib-package-update.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a symlinked destination", async () => {
    const root = await temporaryDirectory();
    const outside = join(root, "outside");
    const linked = join(root, "linked");
    await mkdir(outside);
    await symlink(outside, linked);
    await expect(writePromptPackage(makePromptPackage(), linked)).rejects.toThrow(
      "Refusing symlink",
    );
  });

  it("rejects names that are not portable to Windows or case-insensitive filesystems", async () => {
    const root = await temporaryDirectory();
    const reservedName = makePromptPackage();
    reservedName.artifacts[0] = { ...reservedName.artifacts[0]!, filename: "CON" };
    await expect(writePromptPackage(reservedName, join(root, "reserved"))).rejects.toThrow(
      "Unsafe portable relative path",
    );

    const trailingDot = makePromptPackage();
    trailingDot.artifacts[0] = { ...trailingDot.artifacts[0]!, filename: "prompt. " };
    await expect(writePromptPackage(trailingDot, join(root, "trailing-dot"))).rejects.toThrow(
      "Unsafe portable relative path",
    );

    const caseCollision = makePromptPackage();
    caseCollision.artifacts.push({
      ...caseCollision.artifacts[0]!,
      filename: "PROMPT.MD",
    });
    await expect(writePromptPackage(caseCollision, join(root, "collision"))).rejects.toThrow(
      "Portable export path collision",
    );
  });
});

describe("clipboard export", () => {
  it("formats without side effects and writes only through an explicit adapter", async () => {
    const promptPackage = makePromptPackage();
    const clipboard = new MemoryClipboardWriter();
    const formatted = formatPromptPackageForClipboard(promptPackage);
    expect(clipboard.value).toBe("");
    const result = await exportPromptPackage(promptPackage, {
      format: "clipboard",
      clipboard,
    });
    expect(result.format).toBe("clipboard");
    expect(clipboard.value).toBe(formatted);
    expect(clipboard.value).toContain("Verification: compiled");
  });

  it("preserves whitespace-sensitive artifact content", () => {
    const promptPackage = makePromptPackage();
    promptPackage.artifacts[0] = {
      ...promptPackage.artifacts[0]!,
      content: "  leading whitespace\n\n",
    };
    expect(formatPromptPackageForClipboard(promptPackage)).toContain(
      "## openai-gpt: prompt.md\n\n  leading whitespace\n\n",
    );
  });
});

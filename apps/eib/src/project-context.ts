import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const MAX_CONTEXT_FILE_BYTES = 512 * 1024;
const INLINE_INSTRUCTION_BYTES = 12 * 1024;

export interface ContextManifestEntry {
  readonly path: string;
  readonly included: boolean;
  readonly reason: string;
  readonly sha256?: string;
  readonly bytes?: number;
  readonly inlineContent?: string;
}

export interface ContextManifest {
  readonly mode: "scoped" | "deep";
  readonly root: string;
  readonly entries: readonly ContextManifestEntry[];
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function relativePortable(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function excludedByPath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (/(^|\/)(node_modules|dist|coverage|\.git|\.eib)(\/|$)/u.test(normalized)) {
    return "generated_or_tool_directory";
  }
  if (/(^|\/)(\.env(?:\.|$)|id_rsa|credentials?|secrets?)(\/|$)|\.(pem|key|p12|pfx)$/u.test(normalized)) {
    return "secret_named_path";
  }
  return undefined;
}

function containsSecret(value: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}/iu.test(
    value,
  );
}

function textContent(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) return undefined;
  const content = buffer.toString("utf8");
  return content.includes("\uFFFD") ? undefined : content;
}

async function trackedFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

async function inspectFile(
  root: string,
  relativePath: string,
  reason: string,
  inline = false,
): Promise<ContextManifestEntry> {
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${resolve(root)}/`) && absolute !== resolve(root)) {
    return { path: relativePath, included: false, reason: "outside_workspace" };
  }
  const excluded = excludedByPath(relativePath);
  if (excluded !== undefined) return { path: relativePath, included: false, reason: excluded };
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { path: relativePath, included: false, reason: "not_regular_file" };
    }
    if (stats.size > MAX_CONTEXT_FILE_BYTES) {
      return { path: relativePath, included: false, reason: "too_large", bytes: stats.size };
    }
    const buffer = await readFile(absolute);
    const content = textContent(buffer);
    if (content === undefined) return { path: relativePath, included: false, reason: "binary_or_invalid_utf8", bytes: stats.size };
    if (containsSecret(content)) return { path: relativePath, included: false, reason: "secret_content", bytes: stats.size };
    return {
      path: relativePortable(root, absolute),
      included: true,
      reason,
      sha256: digest(content),
      bytes: stats.size,
      ...(inline ? { inlineContent: content.slice(0, INLINE_INSTRUCTION_BYTES) } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: relativePath, included: false, reason: "missing" };
    }
    throw error;
  }
}

function scopedCandidates(brief: string): Array<{ path: string; reason: string; inline?: boolean }> {
  const baseline = [
    { path: "AGENTS.md", reason: "project_instructions", inline: true },
    { path: "CLAUDE.md", reason: "project_instructions", inline: true },
    { path: "README.md", reason: "project_overview", inline: false },
    { path: "package.json", reason: "project_manifest", inline: false },
    { path: "pyproject.toml", reason: "project_manifest", inline: false },
    { path: "Cargo.toml", reason: "project_manifest", inline: false },
    { path: "go.mod", reason: "project_manifest", inline: false },
  ];
  const wantsArchitecture = /\b(?:architecture|system|structure|dependency|project)\b/iu.test(brief);
  return wantsArchitecture
    ? [...baseline, { path: "CONTRIBUTING.md", reason: "architecture_workflow", inline: false }]
    : baseline;
}

function requestTerms(brief: string): string[] {
  const ignored = new Set(["about", "agent", "architecture", "everything", "project", "review", "steps", "sure", "that", "the", "this", "update", "with", "what"]);
  return [...new Set(
    brief.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/gu)?.filter((term) => !ignored.has(term)) ?? [],
  )];
}

/** Collect only safe, visible context. Deep mode examines every tracked text file. */
export async function discoverProjectContext(options: {
  readonly root: string;
  readonly brief: string;
  readonly deep: boolean;
  readonly tracked?: readonly string[];
}): Promise<ContextManifest> {
  const root = resolve(options.root);
  const availableTracked = options.tracked ?? await trackedFiles(root);
  const candidates: Array<{ path: string; reason: string; inline?: boolean }> = options.deep
    ? availableTracked.map((path) => ({ path, reason: "tracked_repository_file" }))
    : [
        ...scopedCandidates(options.brief),
        ...availableTracked
          .filter((path) => requestTerms(options.brief).some((term) => path.toLowerCase().includes(term)))
          .slice(0, 6)
          .map((path) => ({ path, reason: "request_relevant_path" })),
      ];
  const deduplicated = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
  const entries = await Promise.all(
    deduplicated.map((candidate) =>
      inspectFile(root, candidate.path, candidate.reason, candidate.inline === true),
    ),
  );
  return { mode: options.deep ? "deep" : "scoped", root, entries };
}

export function contextPromptEntries(manifest: ContextManifest): Array<{
  readonly id: string;
  readonly source: string;
  readonly trust: "user";
  readonly summary: string;
}> {
  return manifest.entries
    .filter((entry) => entry.included)
    .map((entry, index) => ({
      id: `project-context-${index + 1}`,
      source: `project file: ${entry.path}`,
      trust: "user" as const,
      summary: entry.inlineContent === undefined
        ? `Selected ${entry.path} (${entry.reason}; sha256 ${entry.sha256}). Inspect this project file before deciding relevant implementation details.`
        : `Selected ${entry.path} (${entry.reason}; sha256 ${entry.sha256}).\n\n${entry.inlineContent}`,
    }));
}

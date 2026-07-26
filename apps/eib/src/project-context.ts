import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const MAX_CONTEXT_FILE_BYTES = 512 * 1024;
const INLINE_INSTRUCTION_BYTES = 12 * 1024;
const EXCERPT_BYTES = 2 * 1024;
const MAX_PROMPT_CONTEXT_BYTES = 32 * 1024;
const CONTEXT_SCAN_CONCURRENCY = 8;

export interface ContextManifestEntry {
  readonly path: string;
  readonly included: boolean;
  readonly reason: string;
  readonly sha256?: string;
  readonly bytes?: number;
  readonly inlineContent?: string;
  /** A bounded, visible excerpt of a request-relevant non-instruction file. */
  readonly excerptContent?: string;
  readonly contentTruncated?: boolean;
}

export interface RepositorySnapshot {
  /** Current Git commit, or null when the directory is not a Git worktree. */
  readonly head: string | null;
  /** Counts only; paths are intentionally not copied into prompt context. */
  readonly status: "clean" | "dirty" | "unavailable";
  readonly changedEntries: number;
}

export interface ContextManifest {
  readonly mode: "scoped" | "deep";
  readonly root: string;
  readonly repository: RepositorySnapshot;
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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The context scan was cancelled.", "AbortError");
  }
}

async function trackedFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  assertNotAborted(signal);
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    });
    assertNotAborted(signal);
    return stdout.split("\0").filter(Boolean);
  } catch {
    assertNotAborted(signal);
    return [];
  }
}

async function repositorySnapshot(root: string, signal?: AbortSignal): Promise<RepositorySnapshot> {
  assertNotAborted(signal);
  try {
    const [head, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, signal }),
      execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: root, signal }),
    ]);
    assertNotAborted(signal);
    return {
      head: head.stdout.trim() || null,
      status: status.stdout.length === 0 ? "clean" : "dirty",
      changedEntries: status.stdout.split("\0").filter(Boolean).length,
    };
  } catch {
    assertNotAborted(signal);
    return { head: null, status: "unavailable", changedEntries: 0 };
  }
}

async function inspectFile(
  root: string,
  relativePath: string,
  reason: string,
  contentMode: "instruction" | "excerpt" | undefined,
  signal?: AbortSignal,
): Promise<ContextManifestEntry> {
  assertNotAborted(signal);
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
    assertNotAborted(signal);
    const content = textContent(buffer);
    if (content === undefined) return { path: relativePath, included: false, reason: "binary_or_invalid_utf8", bytes: stats.size };
    if (containsSecret(content)) return { path: relativePath, included: false, reason: "secret_content", bytes: stats.size };
    return {
      path: relativePortable(root, absolute),
      included: true,
      reason,
      sha256: digest(content),
      bytes: stats.size,
      ...(contentMode === "instruction"
        ? {
            inlineContent: content.slice(0, INLINE_INSTRUCTION_BYTES),
            ...(content.length > INLINE_INSTRUCTION_BYTES ? { contentTruncated: true } : {}),
          }
        : {}),
      ...(contentMode === "excerpt"
        ? {
            excerptContent: content.slice(0, EXCERPT_BYTES),
            ...(content.length > EXCERPT_BYTES ? { contentTruncated: true } : {}),
          }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: relativePath, included: false, reason: "missing" };
    }
    throw error;
  }
}

function scopedCandidates(brief: string): Array<{ path: string; reason: string; contentMode?: "instruction" | "excerpt" }> {
  const baseline = [
    { path: "AGENTS.md", reason: "project_instructions", contentMode: "instruction" as const },
    { path: "CLAUDE.md", reason: "project_instructions", contentMode: "instruction" as const },
    { path: "README.md", reason: "project_overview", contentMode: "excerpt" as const },
    { path: "package.json", reason: "project_manifest", contentMode: "excerpt" as const },
    { path: "pyproject.toml", reason: "project_manifest", contentMode: "excerpt" as const },
    { path: "Cargo.toml", reason: "project_manifest", contentMode: "excerpt" as const },
    { path: "go.mod", reason: "project_manifest", contentMode: "excerpt" as const },
  ];
  const wantsArchitecture = /\b(?:architecture|system|structure|dependency|project)\b/iu.test(brief);
  return wantsArchitecture
    ? [...baseline, { path: "CONTRIBUTING.md", reason: "architecture_workflow", contentMode: "excerpt" as const }]
    : baseline;
}

function boundPromptContent(entries: readonly ContextManifestEntry[]): ContextManifestEntry[] {
  let remaining = MAX_PROMPT_CONTEXT_BYTES;
  return entries.map((entry) => {
    const key = entry.inlineContent === undefined ? "excerptContent" : "inlineContent";
    const content = entry[key];
    if (content === undefined) return entry;
    if (remaining <= 0) {
      return {
        path: entry.path,
        included: entry.included,
        reason: entry.reason,
        ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
        ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
        contentTruncated: true,
      };
    }
    const selected = content.slice(0, remaining);
    remaining -= Buffer.byteLength(selected, "utf8");
    if (selected === content) return entry;
    return key === "inlineContent"
      ? { ...entry, inlineContent: selected, contentTruncated: true }
      : { ...entry, excerptContent: selected, contentTruncated: true };
  });
}

async function inspectCandidates(
  root: string,
  candidates: readonly { path: string; reason: string; contentMode?: "instruction" | "excerpt" }[],
  signal?: AbortSignal,
): Promise<ContextManifestEntry[]> {
  const results = Array<ContextManifestEntry>(candidates.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      assertNotAborted(signal);
      const index = next;
      next += 1;
      if (index >= candidates.length) return;
      const candidate = candidates[index]!;
      results[index] = await inspectFile(root, candidate.path, candidate.reason, candidate.contentMode, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONTEXT_SCAN_CONCURRENCY, candidates.length) }, () => worker()));
  return results;
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
  /** Stops scheduling work safely; no partially scanned manifest is returned. */
  readonly signal?: AbortSignal;
}): Promise<ContextManifest> {
  const root = resolve(options.root);
  assertNotAborted(options.signal);
  const [availableTracked, repository] = await Promise.all([
    options.tracked === undefined ? trackedFiles(root, options.signal) : Promise.resolve(options.tracked),
    repositorySnapshot(root, options.signal),
  ]);
  const candidates: Array<{ path: string; reason: string; contentMode?: "instruction" | "excerpt" }> = options.deep
    ? availableTracked.map((path) => ({ path, reason: "tracked_repository_file" }))
    : [
        ...scopedCandidates(options.brief),
        ...availableTracked
          .filter((path) => requestTerms(options.brief).some((term) => path.toLowerCase().includes(term)))
          .slice(0, 6)
          .map((path) => ({ path, reason: "request_relevant_path", contentMode: "excerpt" as const })),
      ];
  const deduplicated = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
  const entries = boundPromptContent(await inspectCandidates(root, deduplicated, options.signal));
  return { mode: options.deep ? "deep" : "scoped", root, repository, entries };
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
      summary: entry.inlineContent === undefined && entry.excerptContent === undefined
        ? `Selected ${entry.path} (${entry.reason}; sha256 ${entry.sha256}). Inspect this project file before deciding relevant implementation details.`
        : `Selected ${entry.path} (${entry.reason}; sha256 ${entry.sha256}${entry.contentTruncated === true ? "; bounded excerpt" : ""}).\n\n${entry.inlineContent ?? entry.excerptContent}`,
    }));
}

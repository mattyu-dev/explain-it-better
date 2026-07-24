import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  PromptPackageSchema,
  type PromptPackage,
} from "../contracts.js";

const PACKAGE_FILENAME = "prompt-package.json";
const MANIFEST_FILENAME = ".eib-package-manifest.json";

type Provenance = PromptPackage["blueprint"]["intent"]["context"][number];

interface PackageFileManifest {
  readonly version: 1;
  readonly packageId: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface WritePromptPackageOptions {
  /**
   * Managed files may be updated only when their current hash still equals the
   * prior manifest. User-edited and unowned files are never overwritten.
   */
  readonly updateManaged?: boolean;
}

export interface WrittenPromptPackage {
  readonly directory: string;
  readonly packageFile: string;
  readonly files: readonly string[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function portableRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => !isPortablePathSegment(part))
  ) {
    throw new Error(`Unsafe portable relative path ${JSON.stringify(value)}.`);
  }
  return normalized;
}

/**
 * Keep exported paths usable on common case-insensitive and Windows filesystems,
 * rather than accepting a name which only works on the host that created it.
 */
function isPortablePathSegment(value: string): boolean {
  const hasForbiddenCharacter = [...value].some(
    (character) => character.charCodeAt(0) <= 31 || '<>:"|?*'.includes(character),
  );
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    hasForbiddenCharacter ||
    /[. ]$/u.test(value)
  ) {
    return false;
  }
  const stem = value.split(".", 1)[0]?.toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem ?? "");
}

function portablePathCollisionKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function portableSegment(value: string): string {
  const encoded = encodeURIComponent(value).replaceAll("%", "_");
  if (!isPortablePathSegment(encoded)) {
    throw new Error(`Unsafe portable path segment ${JSON.stringify(value)}.`);
  }
  return encoded;
}

function verificationReport(promptPackage: PromptPackage): string {
  const passed = promptPackage.results.filter((result) => result.passed).length;
  const failed = promptPackage.results.length - passed;
  const warnings =
    promptPackage.warnings.length === 0
      ? "- None"
      : promptPackage.warnings.map((warning) => `- ${warning}`).join("\n");
  return [
    `# Verification report: ${markdownEscape(promptPackage.id)}`,
    "",
    `- Status: \`${promptPackage.verification}\``,
    `- Package version: \`${promptPackage.version}\``,
    `- Knowledge pack: \`${markdownEscape(promptPackage.knowledge.packVersion)}\``,
    `- Evaluation results: ${promptPackage.results.length} (${passed} passed, ${failed} failed)`,
    `- Human approval records: ${promptPackage.approvalRecords.length}`,
    "",
    "## Warnings",
    "",
    warnings,
    "",
    "This report records evidence level; it does not claim universal prompt optimality.",
    "",
  ].join("\n");
}

function originalBrief(promptPackage: PromptPackage): string {
  const lineage =
    promptPackage.clarificationLineage.length === 0
      ? "- None"
      : promptPackage.clarificationLineage
          .map(
            (item) =>
              `- **${item.assumed ? "Assumed" : "Answered"}:** ${item.question}\n  - ${item.answer}`,
          )
          .join("\n");
  return [
    "# Original brief",
    "",
    promptPackage.originalBrief,
    "",
    "## Clarification lineage",
    "",
    lineage,
    "",
  ].join("\n");
}

function provenance(promptPackage: PromptPackage): {
  readonly packageId: string;
  readonly createdAt: string;
  readonly sources: readonly Provenance[];
  readonly knowledge: PromptPackage["knowledge"];
} {
  return {
    packageId: promptPackage.id,
    createdAt: promptPackage.createdAt,
    sources: promptPackage.blueprint.intent.context,
    knowledge: promptPackage.knowledge,
  };
}

function buildPortableFiles(promptPackage: PromptPackage): ReadonlyMap<string, string> {
  const parsed = PromptPackageSchema.parse(promptPackage);
  const files = new Map<string, string>([
    [PACKAGE_FILENAME, json(parsed)],
    ["blueprint.json", json(parsed.blueprint)],
    ["original-brief.md", originalBrief(parsed)],
    ["evals.jsonl", parsed.evals.map((evalCase) => JSON.stringify(evalCase)).join("\n") + "\n"],
    ["provenance.json", json(provenance(parsed))],
    ["verification-report.md", verificationReport(parsed)],
    ["tools.json", json(parsed.blueprint.tools)],
    ["mcp-servers.json", json(parsed.blueprint.mcpServers)],
    ["typed-inputs.json", json(parsed.blueprint.typedInputs)],
    ["approval-policy.json", json(parsed.blueprint.approvals)],
    ["approval-records.json", json(parsed.approvalRecords)],
    ["subagents.json", json(parsed.blueprint.subagents)],
  ]);
  if (parsed.blueprint.intent.outputContract.schema !== undefined) {
    files.set("output-schema.json", json(parsed.blueprint.intent.outputContract.schema));
  }

  for (const artifact of parsed.artifacts) {
    const target = portableSegment(artifact.targetId);
    const artifactPath = portableRelativePath(artifact.filename);
    const path = `artifacts/${target}/${artifactPath}`;
    if (files.has(path)) {
      throw new Error(`Portable export path collision at ${JSON.stringify(path)}.`);
    }
    files.set(path, artifact.content.endsWith("\n") ? artifact.content : `${artifact.content}\n`);
  }
  const collisionKeys = new Set<string>();
  for (const path of files.keys()) {
    const collisionKey = portablePathCollisionKey(path);
    if (collisionKeys.has(collisionKey)) {
      throw new Error(`Portable export path collision at ${JSON.stringify(path)}.`);
    }
    collisionKeys.add(collisionKey);
  }
  return files;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSymlinkPath(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter((segment) => segment.length > 0);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing symlink in package path ${JSON.stringify(current)}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertSafePackageDestination(destination: string): string {
  if (destination.includes("\0")) throw new Error("Destination contains a null byte.");
  const absolute = resolve(destination);
  const root = parse(absolute).root;
  const normalizedInput = isAbsolute(destination) ? normalize(destination) : absolute;
  if (normalizedInput !== absolute) {
    throw new Error("Destination must resolve to one exact normalized path.");
  }
  if (absolute === root || absolute === homedir() || absolute === process.cwd()) {
    throw new Error(`Refusing broad package destination ${JSON.stringify(absolute)}.`);
  }
  return absolute;
}

async function readManifest(directory: string): Promise<PackageFileManifest | undefined> {
  const path = join(directory, MANIFEST_FILENAME);
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { version?: unknown }).version !== 1 ||
      typeof (value as { packageId?: unknown }).packageId !== "string" ||
      typeof (value as { files?: unknown }).files !== "object" ||
      (value as { files?: unknown }).files === null
    ) {
      throw new Error(`Invalid package ownership manifest at ${JSON.stringify(path)}.`);
    }
    const manifest = value as PackageFileManifest;
    const seenPaths = new Set<string>();
    for (const [relativePath, hash] of Object.entries(manifest.files)) {
      const collisionKey = portablePathCollisionKey(relativePath);
      if (
        portableRelativePath(relativePath) !== relativePath ||
        collisionKey === MANIFEST_FILENAME ||
        seenPaths.has(collisionKey) ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(hash)
      ) {
        throw new Error(`Invalid package ownership record for ${JSON.stringify(relativePath)}.`);
      }
      seenPaths.add(collisionKey);
    }
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const parent = dirname(path);
  // These checks narrow the race window, but Node does not expose an openat-style
  // no-follow API. A hostile concurrent writer can still swap a parent afterwards.
  await assertNoSymlinkPath(parent);
  await mkdir(parent, { recursive: true });
  await assertNoSymlinkPath(parent);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoSymlinkPath(parent);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function writePromptPackage(
  promptPackage: PromptPackage,
  destination: string,
  options: WritePromptPackageOptions = {},
): Promise<WrittenPromptPackage> {
  const directory = assertSafePackageDestination(destination);
  await assertNoSymlinkPath(directory);
  const files = buildPortableFiles(promptPackage);
  const exists = await pathExists(directory);
  const previousManifest = exists ? await readManifest(directory) : undefined;
  if (exists && previousManifest === undefined && (await readdir(directory)).length > 0) {
    throw new Error(
      `Destination ${JSON.stringify(directory)} is non-empty and has no EIB ownership manifest.`,
    );
  }
  if (previousManifest !== undefined && previousManifest.packageId !== promptPackage.id) {
    throw new Error(
      `Destination is owned by package ${JSON.stringify(previousManifest.packageId)}, not ${JSON.stringify(promptPackage.id)}.`,
    );
  }

  const conflicts: string[] = [];
  const staleManagedFiles: string[] = [];
  for (const [relativePath, content] of files) {
    const path = join(directory, ...relativePath.split("/"));
    await assertNoSymlinkPath(path);
    if (!(await pathExists(path))) continue;
    const current = await readFile(path, "utf8");
    if (current === content) continue;
    const priorHash = previousManifest?.files[relativePath];
    const isUnmodifiedManaged =
      priorHash !== undefined && priorHash === sha256(current) && options.updateManaged !== false;
    if (!isUnmodifiedManaged) conflicts.push(relativePath);
  }
  for (const [relativePath, priorHash] of Object.entries(
    previousManifest?.files ?? {},
  )) {
    if (files.has(relativePath)) continue;
    const path = join(directory, ...relativePath.split("/"));
    await assertNoSymlinkPath(path);
    if (!(await pathExists(path))) continue;
    const current = await readFile(path, "utf8");
    if (sha256(current) !== priorHash || options.updateManaged === false) {
      conflicts.push(relativePath);
      continue;
    }
    staleManagedFiles.push(relativePath);
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Refusing to overwrite unowned or modified package files: ${conflicts.join(", ")}.`,
    );
  }

  await mkdir(directory, { recursive: true });
  for (const [relativePath, content] of files) {
    const path = join(directory, ...relativePath.split("/"));
    await assertNoSymlinkPath(path);
    const destinationRelative = relative(directory, path);
    if (destinationRelative.startsWith(`..${sep}`) || isAbsolute(destinationRelative)) {
      throw new Error(`Resolved package path escaped destination: ${relativePath}.`);
    }
    await atomicWrite(path, content);
  }
  for (const relativePath of staleManagedFiles) {
    const path = join(directory, ...relativePath.split("/"));
    await assertNoSymlinkPath(path);
    await unlink(path);
  }
  const manifest: PackageFileManifest = {
    version: 1,
    packageId: promptPackage.id,
    files: Object.fromEntries([...files].map(([path, content]) => [path, sha256(content)])),
  };
  await atomicWrite(join(directory, MANIFEST_FILENAME), json(manifest));

  return {
    directory,
    packageFile: join(directory, PACKAGE_FILENAME),
    files: [...files.keys(), MANIFEST_FILENAME],
  };
}

export async function readPromptPackage(path: string): Promise<PromptPackage> {
  const candidate = resolve(path);
  const stats = await lstat(candidate);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing symlinked package path ${JSON.stringify(candidate)}.`);
  }
  const packageFile = stats.isDirectory() ? join(candidate, PACKAGE_FILENAME) : candidate;
  await assertNoSymlinkPath(packageFile);
  const value: unknown = JSON.parse(await readFile(packageFile, "utf8"));
  return PromptPackageSchema.parse(value);
}

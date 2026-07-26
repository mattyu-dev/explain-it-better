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
const UPDATE_FILENAME = ".eib-package-update.json";

type Provenance = PromptPackage["prompt"]["demand"]["context"][number];

interface PackageFileManifest {
  readonly version: 1;
  readonly packageId: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Durable intent for a multi-file package update. Writing the manifest last is
 * normally sufficient for readers, but an interrupted update would otherwise
 * leave new files owned by the old manifest and make the next update refuse to
 * proceed. The journal lets a later write finish that exact update safely.
 */
interface PackageUpdateJournal {
  readonly version: 1;
  readonly packageId: string;
  readonly previousManifest?: PackageFileManifest;
  readonly files: Readonly<Record<string, string>>;
  readonly staleManagedFiles: Readonly<Record<string, string>>;
  readonly manifest: PackageFileManifest;
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
    "",
    "## Warnings",
    "",
    warnings,
    "",
    "This report records the evidence behind this prompt; it does not claim universal prompt optimality.",
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
    sources: promptPackage.prompt.demand.context,
    knowledge: promptPackage.knowledge,
  };
}

function buildPortableFiles(promptPackage: PromptPackage): ReadonlyMap<string, string> {
  const parsed = PromptPackageSchema.parse(promptPackage);
  const files = new Map<string, string>([
    [PACKAGE_FILENAME, json(parsed)],
    ["prompt.json", json(parsed.prompt)],
    ["original-brief.md", originalBrief(parsed)],
    ["evals.jsonl", parsed.evals.map((evalCase) => JSON.stringify(evalCase)).join("\n") + "\n"],
    ["provenance.json", json(provenance(parsed))],
    ["verification-report.md", verificationReport(parsed)],
    ["input-bindings.json", json(parsed.prompt.inputBindings)],
  ]);
  if (parsed.prompt.demand.outputContract.schema !== undefined) {
    files.set("output-schema.json", json(parsed.prompt.demand.outputContract.schema));
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
    await assertNoSymlinkPath(path);
    return parseManifest(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(value: unknown, path: string): PackageFileManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.packageId !== "string" ||
    !isRecord(value.files)
  ) {
    throw new Error(`Invalid package ownership manifest at ${JSON.stringify(path)}.`);
  }
  const seenPaths = new Set<string>();
  for (const [relativePath, hash] of Object.entries(value.files)) {
    const collisionKey = portablePathCollisionKey(relativePath);
    if (
      portableRelativePath(relativePath) !== relativePath ||
      collisionKey === portablePathCollisionKey(MANIFEST_FILENAME) ||
      collisionKey === portablePathCollisionKey(UPDATE_FILENAME) ||
      seenPaths.has(collisionKey) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(hash)
    ) {
      throw new Error(`Invalid package ownership record for ${JSON.stringify(relativePath)}.`);
    }
    seenPaths.add(collisionKey);
  }
  return {
    version: 1,
    packageId: value.packageId,
    files: value.files as Record<string, string>,
  };
}

function manifestsEqual(left: PackageFileManifest | undefined, right: PackageFileManifest | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.packageId !== right.packageId) return false;
  const leftEntries = Object.entries(left.files);
  const rightEntries = Object.entries(right.files);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([path, hash]) => right.files[path] === hash)
  );
}

function parseUpdateJournal(value: unknown, path: string): PackageUpdateJournal {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.packageId !== "string" ||
    !isRecord(value.files) ||
    !isRecord(value.staleManagedFiles)
  ) {
    throw new Error(`Invalid pending package update at ${JSON.stringify(path)}.`);
  }
  const manifest = parseManifest(value.manifest, path);
  const previousManifest =
    value.previousManifest === undefined ? undefined : parseManifest(value.previousManifest, path);
  if (
    value.packageId !== manifest.packageId ||
    (previousManifest !== undefined && previousManifest.packageId !== value.packageId)
  ) {
    throw new Error(`Invalid pending package update at ${JSON.stringify(path)}.`);
  }
  const files = value.files;
  const staleManagedFiles = value.staleManagedFiles;
  const filePaths = Object.keys(files);
  const manifestPaths = Object.keys(manifest.files);
  const seenPaths = new Set<string>();
  if (filePaths.length !== manifestPaths.length) {
    throw new Error(`Invalid pending package update at ${JSON.stringify(path)}.`);
  }
  for (const relativePath of filePaths) {
    const collisionKey = portablePathCollisionKey(relativePath);
    const content = files[relativePath];
    if (
      portableRelativePath(relativePath) !== relativePath ||
      seenPaths.has(collisionKey) ||
      typeof content !== "string" ||
      manifest.files[relativePath] !== sha256(content)
    ) {
      throw new Error(`Invalid pending package update at ${JSON.stringify(path)}.`);
    }
    seenPaths.add(collisionKey);
  }
  for (const [relativePath, hash] of Object.entries(staleManagedFiles)) {
    const collisionKey = portablePathCollisionKey(relativePath);
    if (
      portableRelativePath(relativePath) !== relativePath ||
      seenPaths.has(collisionKey) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(hash) ||
      previousManifest?.files[relativePath] !== hash
    ) {
      throw new Error(`Invalid pending package update at ${JSON.stringify(path)}.`);
    }
    seenPaths.add(collisionKey);
  }
  return {
    version: 1,
    packageId: value.packageId,
    ...(previousManifest === undefined ? {} : { previousManifest }),
    files: files as Record<string, string>,
    staleManagedFiles: staleManagedFiles as Record<string, string>,
    manifest,
  };
}

async function readUpdateJournal(directory: string): Promise<PackageUpdateJournal | undefined> {
  const path = join(directory, UPDATE_FILENAME);
  try {
    await assertNoSymlinkPath(path);
    return parseUpdateJournal(JSON.parse(await readFile(path, "utf8")), path);
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

function packageFilePath(directory: string, relativePath: string): string {
  const path = join(directory, ...relativePath.split("/"));
  const destinationRelative = relative(directory, path);
  if (destinationRelative.startsWith(`..${sep}`) || isAbsolute(destinationRelative)) {
    throw new Error(`Resolved package path escaped destination: ${relativePath}.`);
  }
  return path;
}

async function assertRecoveryFileState(
  directory: string,
  relativePath: string,
  expectedHash: string,
  previousHash: string | undefined,
): Promise<void> {
  const path = packageFilePath(directory, relativePath);
  await assertNoSymlinkPath(path);
  if (!(await pathExists(path))) {
    if (previousHash !== undefined) {
      throw new Error(`Cannot recover pending package update: managed file ${JSON.stringify(relativePath)} is missing.`);
    }
    return;
  }
  const currentHash = sha256(await readFile(path, "utf8"));
  if (currentHash !== expectedHash && currentHash !== previousHash) {
    throw new Error(`Cannot recover pending package update: managed file ${JSON.stringify(relativePath)} changed after the interrupted update.`);
  }
}

async function recoverPendingUpdate(directory: string): Promise<void> {
  const journal = await readUpdateJournal(directory);
  if (journal === undefined) return;

  const currentManifest = await readManifest(directory);
  if (
    !manifestsEqual(currentManifest, journal.previousManifest) &&
    !manifestsEqual(currentManifest, journal.manifest)
  ) {
    throw new Error("Cannot recover pending package update: ownership manifest changed after the interrupted update.");
  }

  for (const [relativePath, content] of Object.entries(journal.files)) {
    await assertRecoveryFileState(
      directory,
      relativePath,
      sha256(content),
      journal.previousManifest?.files[relativePath],
    );
  }
  for (const [relativePath, previousHash] of Object.entries(journal.staleManagedFiles)) {
    const path = packageFilePath(directory, relativePath);
    await assertNoSymlinkPath(path);
    if ((await pathExists(path)) && sha256(await readFile(path, "utf8")) !== previousHash) {
      throw new Error(`Cannot recover pending package update: stale file ${JSON.stringify(relativePath)} changed after the interrupted update.`);
    }
  }

  for (const [relativePath, content] of Object.entries(journal.files)) {
    const path = packageFilePath(directory, relativePath);
    await assertNoSymlinkPath(path);
    await atomicWrite(path, content);
  }
  for (const relativePath of Object.keys(journal.staleManagedFiles)) {
    const path = packageFilePath(directory, relativePath);
    await assertNoSymlinkPath(path);
    await unlink(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  await atomicWrite(join(directory, MANIFEST_FILENAME), json(journal.manifest));
  await unlink(join(directory, UPDATE_FILENAME));
}

async function writePackageTransaction(
  directory: string,
  previousManifest: PackageFileManifest | undefined,
  files: ReadonlyMap<string, string>,
  staleManagedFiles: readonly string[],
  manifest: PackageFileManifest,
): Promise<void> {
  const journal: PackageUpdateJournal = {
    version: 1,
    packageId: manifest.packageId,
    ...(previousManifest === undefined ? {} : { previousManifest }),
    files: Object.fromEntries(files),
    staleManagedFiles: Object.fromEntries(
      staleManagedFiles.map((relativePath) => [relativePath, previousManifest!.files[relativePath]!]),
    ),
    manifest,
  };
  await atomicWrite(join(directory, UPDATE_FILENAME), json(journal));
  await recoverPendingUpdate(directory);
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
  if (exists) await recoverPendingUpdate(directory);
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
  const manifest: PackageFileManifest = {
    version: 1,
    packageId: promptPackage.id,
    files: Object.fromEntries([...files].map(([path, content]) => [path, sha256(content)])),
  };
  await writePackageTransaction(directory, previousManifest, files, staleManagedFiles, manifest);

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

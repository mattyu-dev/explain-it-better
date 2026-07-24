import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { PromptPackageSchema, type PromptPackage } from "../contracts.js";

const INSTALL_MANIFEST = ".eib-install-manifest.json";

interface InstalledFileRecord {
  readonly packageId: string;
  readonly targetId: string;
  readonly installedHash: string;
}

interface InstallManifest {
  readonly version: 1;
  readonly files: Readonly<Record<string, InstalledFileRecord>>;
}

export type InstallActionKind = "create" | "update" | "noop" | "conflict";

export interface ObservedInstallContent {
  /** UTF-8 when lossless; otherwise base64 so the reviewed bytes remain exact. */
  readonly encoding: "utf8" | "base64";
  readonly data: string;
}

export interface InstallAction {
  readonly kind: InstallActionKind;
  readonly relativePath: string;
  readonly destination: string;
  readonly targetId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly observedHash: string | null;
  readonly observedContent: ObservedInstallContent | null;
  readonly ownedBefore: boolean;
  readonly reason: string;
}

export interface PlanInstallOptions {
  readonly targetId?: string;
  readonly protectedTargets?: readonly string[];
  readonly now?: Date;
}

export interface InstallPlan {
  readonly version: 1;
  readonly packageId: string;
  readonly target: string;
  readonly manifestPath: string;
  readonly manifestHash: string | null;
  readonly backupDirectory: string;
  readonly actions: readonly InstallAction[];
  readonly protectedTargets: readonly string[];
  readonly createdAt: string;
}

export interface InstallResult {
  readonly applied: true;
  readonly target: string;
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
  readonly backups: readonly string[];
  readonly manifestPath: string;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function encodeObservedContent(content: Buffer): ObservedInstallContent {
  const utf8 = content.toString("utf8");
  return Buffer.from(utf8, "utf8").equals(content)
    ? { encoding: "utf8", data: utf8 }
    : { encoding: "base64", data: content.toString("base64") };
}

function observedContentHash(content: ObservedInstallContent): string {
  return sha256(
    content.encoding === "utf8"
      ? Buffer.from(content.data, "utf8")
      : Buffer.from(content.data, "base64"),
  );
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

function portableRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => !isPortablePathSegment(part))
  ) {
    throw new Error(`Unsafe install filename ${JSON.stringify(value)}.`);
  }
  return normalized;
}

/**
 * Install names must remain valid on case-insensitive and Windows filesystems,
 * so a package behaves identically regardless of where it is reviewed or used.
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

function isReservedInstallPath(relativePath: string): boolean {
  const key = portablePathCollisionKey(relativePath);
  return (
    key === INSTALL_MANIFEST ||
    key.startsWith(`${INSTALL_MANIFEST}/`) ||
    key === ".eib-backups" ||
    key.startsWith(".eib-backups/")
  );
}

function defaultProtectedTargets(): readonly string[] {
  const root = parse(resolve(sep)).root;
  return [
    root,
    homedir(),
    tmpdir(),
    resolve(root, "Applications"),
    resolve(root, "Library"),
    resolve(root, "System"),
    resolve(root, "Users"),
    resolve(root, "etc"),
    resolve(root, "private"),
    resolve(root, "tmp"),
    resolve(root, "usr"),
    resolve(root, "var"),
  ];
}

function assertExactSafeTarget(
  target: string,
  additionalProtected: readonly string[] = [],
): { readonly absolute: string; readonly protectedTargets: readonly string[] } {
  if (target.includes("\0")) throw new Error("Install target contains a null byte.");
  if (!isAbsolute(target)) {
    throw new Error("Install target must be an exact absolute path.");
  }
  const absolute = resolve(target);
  if (normalize(target) !== absolute) {
    throw new Error("Install target must be normalized and cannot contain unresolved segments.");
  }
  const protectedTargets = [
    ...defaultProtectedTargets(),
    ...additionalProtected.map((value) => resolve(value)),
  ];
  if (protectedTargets.some((protectedTarget) => absolute === protectedTarget)) {
    throw new Error(`Refusing broad or protected install target ${JSON.stringify(absolute)}.`);
  }
  return { absolute, protectedTargets };
}

async function assertNoSymlinkPath(path: string, boundary?: string): Promise<void> {
  const absolute = resolve(path);
  const start = boundary === undefined ? parse(absolute).root : resolve(boundary);
  if (boundary !== undefined) assertWithinTarget(start, absolute);
  const segments = relative(start, absolute).split(sep).filter((segment) => segment.length > 0);
  let current = start;
  if (boundary !== undefined) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing symlink in install path ${JSON.stringify(current)}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing symlink in install path ${JSON.stringify(current)}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertWithinTarget(target: string, destination: string): void {
  const value = relative(target, destination);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`Install path ${JSON.stringify(destination)} escapes or aliases its target.`);
  }
}

async function readManifest(
  manifestPath: string,
): Promise<{ readonly manifest: InstallManifest; readonly hash: string } | undefined> {
  try {
    const text = await readFile(manifestPath, "utf8");
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { version?: unknown }).version !== 1 ||
      typeof (value as { files?: unknown }).files !== "object" ||
      (value as { files?: unknown }).files === null
    ) {
      throw new Error(`Invalid installer ownership manifest ${JSON.stringify(manifestPath)}.`);
    }
    const files = (value as { files: Record<string, unknown> }).files;
    const seenPaths = new Set<string>();
    for (const [path, record] of Object.entries(files)) {
      const collisionKey = portablePathCollisionKey(path);
      if (
        portableRelativePath(path) !== path ||
        isReservedInstallPath(path) ||
        seenPaths.has(collisionKey) ||
        typeof record !== "object" ||
        record === null ||
        typeof (record as { packageId?: unknown }).packageId !== "string" ||
        typeof (record as { targetId?: unknown }).targetId !== "string" ||
        typeof (record as { installedHash?: unknown }).installedHash !== "string"
      ) {
        throw new Error(`Invalid installer ownership record for ${JSON.stringify(path)}.`);
      }
      seenPaths.add(collisionKey);
    }
    return { manifest: value as InstallManifest, hash: sha256(text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function timestampSegment(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export async function planInstall(
  promptPackage: PromptPackage,
  target: string,
  options: PlanInstallOptions = {},
): Promise<InstallPlan> {
  const validatedPackage = PromptPackageSchema.parse(promptPackage);
  const safeTarget = assertExactSafeTarget(target, options.protectedTargets);
  await assertNoSymlinkPath(safeTarget.absolute);
  const manifestPath = join(safeTarget.absolute, INSTALL_MANIFEST);
  await assertNoSymlinkPath(manifestPath, safeTarget.absolute);
  const prior = await readManifest(manifestPath);
  const artifacts = validatedPackage.artifacts.filter(
    (artifact) => options.targetId === undefined || artifact.targetId === options.targetId,
  );
  if (artifacts.length === 0) {
    throw new Error(
      options.targetId === undefined
        ? "The package has no installable artifacts."
        : `The package has no artifacts for target ${JSON.stringify(options.targetId)}.`,
    );
  }

  const actions: InstallAction[] = [];
  const seenDestinations = new Set<string>();
  for (const artifact of artifacts) {
    const relativePath = portableRelativePath(artifact.filename);
    const collisionKey = portablePathCollisionKey(relativePath);
    if (isReservedInstallPath(relativePath)) {
      throw new Error(`Artifact path ${JSON.stringify(relativePath)} is reserved for installer state.`);
    }
    if (seenDestinations.has(collisionKey)) {
      throw new Error(`Multiple artifacts resolve to install path ${JSON.stringify(relativePath)}.`);
    }
    seenDestinations.add(collisionKey);
    const destination = join(safeTarget.absolute, ...relativePath.split("/"));
    assertWithinTarget(safeTarget.absolute, destination);
    await assertNoSymlinkPath(destination, safeTarget.absolute);
    const contentHash = sha256(artifact.content);
    const exists = await pathExists(destination);
    const current = exists ? await readFile(destination) : undefined;
    const observedHash = current === undefined ? null : sha256(current);
    const observedContent = current === undefined ? null : encodeObservedContent(current);
    const ownership = prior?.manifest.files[relativePath];

    let kind: InstallActionKind;
    let ownedBefore = false;
    let reason: string;
    if (current === undefined) {
      kind = "create";
      reason = "Destination does not exist.";
    } else if (observedHash === contentHash) {
      kind = "noop";
      ownedBefore =
        ownership?.packageId === validatedPackage.id && ownership.installedHash === observedHash;
      reason = ownedBefore
        ? "Managed destination already has the requested content."
        : "Unowned destination already has identical content; ownership will not be claimed.";
    } else if (ownership === undefined) {
      kind = "conflict";
      reason = "Existing destination is unowned and will not be overwritten.";
    } else if (ownership.packageId !== validatedPackage.id) {
      kind = "conflict";
      reason = `Existing destination is owned by package ${JSON.stringify(ownership.packageId)}.`;
    } else if (ownership.installedHash !== observedHash) {
      kind = "conflict";
      reason = "Managed destination changed after installation and will not be overwritten.";
    } else {
      kind = "update";
      ownedBefore = true;
      reason = "Managed, unmodified destination can be updated with a scoped backup.";
    }

    actions.push({
      kind,
      relativePath,
      destination,
      targetId: artifact.targetId,
      content: artifact.content,
      contentHash,
      observedHash,
      observedContent,
      ownedBefore,
      reason,
    });
  }

  const now = options.now ?? new Date();
  return {
    version: 1,
    packageId: validatedPackage.id,
    target: safeTarget.absolute,
    manifestPath,
    manifestHash: prior?.hash ?? null,
    backupDirectory: join(
      safeTarget.absolute,
      ".eib-backups",
      `${timestampSegment(now)}-${sha256(validatedPackage.id).slice(0, 16)}`,
    ),
    actions,
    protectedTargets: safeTarget.protectedTargets,
    createdAt: now.toISOString(),
  };
}

async function atomicWrite(path: string, content: string, boundary: string): Promise<void> {
  const parent = dirname(path);
  // This revalidation narrows the check-to-use interval. Node has no portable
  // descriptor-relative no-follow primitive, so hostile concurrent replacement
  // of a parent directory remains outside this API's complete prevention scope.
  await assertNoSymlinkPath(parent, resolve(parent) === resolve(boundary) ? undefined : boundary);
  await mkdir(parent, { recursive: true });
  await assertNoSymlinkPath(parent, resolve(parent) === resolve(boundary) ? undefined : boundary);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoSymlinkPath(parent, resolve(parent) === resolve(boundary) ? undefined : boundary);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function observedHash(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertPlanHasNoConflicts(plan: InstallPlan): void {
  const conflicts = plan.actions.filter((action) => action.kind === "conflict");
  if (conflicts.length > 0) {
    throw new Error(
      `Install plan has conflicts: ${conflicts.map((action) => action.relativePath).join(", ")}.`,
    );
  }
}

function validatePlanIntegrity(plan: InstallPlan): void {
  if (plan.packageId.trim().length === 0) throw new Error("Install plan package id is empty.");
  if (plan.manifestPath !== join(plan.target, INSTALL_MANIFEST)) {
    throw new Error("Install plan manifest path does not match its target.");
  }
  const backupRelative = relative(plan.target, plan.backupDirectory);
  if (
    backupRelative === ".eib-backups" ||
    !backupRelative.startsWith(`.eib-backups${sep}`)
  ) {
    throw new Error("Install plan backup directory is outside the scoped backup area.");
  }
  if (plan.actions.length === 0) throw new Error("Install plan has no actions.");

  const seen = new Set<string>();
  for (const action of plan.actions) {
    if (
      action.kind !== "create" &&
      action.kind !== "update" &&
      action.kind !== "noop" &&
      action.kind !== "conflict"
    ) {
      throw new Error(`Install plan has unknown action kind ${JSON.stringify(action.kind)}.`);
    }
    const relativePath = portableRelativePath(action.relativePath);
    const collisionKey = portablePathCollisionKey(relativePath);
    if (
      relativePath !== action.relativePath ||
      isReservedInstallPath(relativePath) ||
      seen.has(collisionKey)
    ) {
      throw new Error(`Install plan has an invalid or duplicate path ${JSON.stringify(relativePath)}.`);
    }
    seen.add(collisionKey);
    const expectedDestination = join(plan.target, ...relativePath.split("/"));
    if (action.destination !== expectedDestination) {
      throw new Error(`Install action destination does not match ${JSON.stringify(relativePath)}.`);
    }
    if (action.contentHash !== sha256(action.content)) {
      throw new Error(`Install action content hash is invalid for ${JSON.stringify(relativePath)}.`);
    }
    if (
      action.observedHash !== null &&
      !/^[a-f0-9]{64}$/.test(action.observedHash)
    ) {
      throw new Error(`Install action observed hash is invalid for ${JSON.stringify(relativePath)}.`);
    }
    if (action.kind === "create" && action.observedHash !== null) {
      throw new Error(`Create action unexpectedly observed ${JSON.stringify(relativePath)}.`);
    }
    if (
      (action.observedHash === null) !== (action.observedContent === null) ||
      (action.observedContent !== null &&
        observedContentHash(action.observedContent) !== action.observedHash)
    ) {
      throw new Error(`Install action observed content is invalid for ${JSON.stringify(relativePath)}.`);
    }
    if (
      action.observedContent !== null &&
      action.observedContent.encoding !== "utf8" &&
      action.observedContent.encoding !== "base64"
    ) {
      throw new Error(`Install action observed encoding is invalid for ${JSON.stringify(relativePath)}.`);
    }
    if (
      action.observedContent?.encoding === "base64" &&
      Buffer.from(action.observedContent.data, "base64").toString("base64") !==
        action.observedContent.data
    ) {
      throw new Error(`Install action observed base64 is invalid for ${JSON.stringify(relativePath)}.`);
    }
    if (action.kind === "update" && (!action.ownedBefore || action.observedHash === null)) {
      throw new Error(`Update action lacks prior ownership for ${JSON.stringify(relativePath)}.`);
    }
    if (action.targetId.trim().length === 0) {
      throw new Error(`Install action target id is empty for ${JSON.stringify(relativePath)}.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInstallPlan(value: unknown): value is InstallPlan {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.packageId === "string" &&
    typeof value.target === "string" &&
    typeof value.manifestPath === "string" &&
    (typeof value.manifestHash === "string" || value.manifestHash === null) &&
    typeof value.backupDirectory === "string" &&
    Array.isArray(value.actions) &&
    Array.isArray(value.protectedTargets) &&
    typeof value.createdAt === "string"
  );
}

function terminalSafeJson(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    },
  );
}

function escapedDiffLines(content: string, prefix: "+" | "-"): readonly string[] {
  if (content.length === 0) return [`${prefix}<empty>`];
  return content.split("\n").map((line) => {
    const serialized = terminalSafeJson(line);
    return `${prefix}${serialized.slice(1, -1)}`;
  });
}

function escapedTerminalText(value: string): string {
  const serialized = terminalSafeJson(value);
  return serialized.slice(1, -1);
}

function renderObservedDiff(content: ObservedInstallContent): readonly string[] {
  return content.encoding === "utf8"
    ? escapedDiffLines(content.data, "-")
    : [`-${content.data} [base64 exact bytes]`];
}

/**
 * Human-readable and terminal-safe review output. Exact content is repeated as
 * a JSON string (or base64 for non-UTF-8 files), preventing control sequences
 * in an existing file or generated artifact from executing in the terminal.
 */
export function formatInstallPlan(plan: InstallPlan): string {
  validatePlanIntegrity(plan);
  const lines = [
    `Install dry run for package ${terminalSafeJson(plan.packageId)}`,
    `Target: ${escapedTerminalText(plan.target)}`,
    `Ownership manifest: ${escapedTerminalText(plan.manifestPath)}`,
    "No files were written.",
  ];

  for (const action of plan.actions) {
    lines.push(
      "",
      `[${action.kind.toUpperCase()}] ${escapedTerminalText(action.destination)}`,
      `Reason: ${escapedTerminalText(action.reason)}`,
      `Observed SHA-256: ${action.observedHash ?? "<missing>"}`,
      `Requested SHA-256: ${action.contentHash}`,
    );
    if (action.kind !== "noop") {
      lines.push(
        "Diff:",
        `--- ${action.observedContent === null ? "/dev/null" : escapedTerminalText(action.destination)}`,
        `+++ ${escapedTerminalText(action.destination)}`,
      );
      if (action.observedContent !== null) {
        lines.push(...renderObservedDiff(action.observedContent));
      }
      lines.push(...escapedDiffLines(action.content, "+"));
    } else {
      lines.push("Diff: no content change");
    }
    if (action.observedContent === null) {
      lines.push("Exact observed content: <missing>");
    } else {
      lines.push(
        `Exact observed content (${action.observedContent.encoding} JSON): ${terminalSafeJson(action.observedContent.data)}`,
      );
    }
    lines.push(`Exact requested content (utf8 JSON): ${terminalSafeJson(action.content)}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function applyInstall(plan: InstallPlan): Promise<InstallResult> {
  if (plan.version !== 1) throw new Error(`Unsupported install plan version ${String(plan.version)}.`);
  validatePlanIntegrity(plan);
  assertPlanHasNoConflicts(plan);
  const safeTarget = assertExactSafeTarget(plan.target, plan.protectedTargets);
  if (safeTarget.absolute !== plan.target) throw new Error("Install plan target is not canonical.");
  await assertNoSymlinkPath(plan.target);
  await assertNoSymlinkPath(plan.manifestPath, plan.target);

  const currentManifest = await readManifest(plan.manifestPath);
  if ((currentManifest?.hash ?? null) !== plan.manifestHash) {
    throw new Error("Installer manifest changed after planning; create a fresh dry-run plan.");
  }

  for (const action of plan.actions) {
    assertWithinTarget(plan.target, action.destination);
    await assertNoSymlinkPath(action.destination, plan.target);
    const currentHash = await observedHash(action.destination);
    if (currentHash !== action.observedHash) {
      throw new Error(
        `Destination ${JSON.stringify(action.relativePath)} changed after planning; no files were written.`,
      );
    }
  }

  const files: Record<string, InstalledFileRecord> = {
    ...(currentManifest?.manifest.files ?? {}),
  };
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const backups: string[] = [];

  for (const action of plan.actions) {
    if (action.kind === "noop") {
      unchanged.push(action.relativePath);
      continue;
    }
    if (action.kind === "update") {
      const backup = join(plan.backupDirectory, ...action.relativePath.split("/"));
      assertWithinTarget(plan.target, backup);
      await assertNoSymlinkPath(backup, plan.target);
      const backupParent = dirname(backup);
      await assertNoSymlinkPath(backupParent, plan.target);
      await mkdir(backupParent, { recursive: true });
      await assertNoSymlinkPath(backupParent, plan.target);
      await copyFile(action.destination, backup, fsConstants.COPYFILE_EXCL);
      backups.push(backup);
      updated.push(action.relativePath);
    } else {
      created.push(action.relativePath);
    }
    await atomicWrite(action.destination, action.content, plan.target);
    files[action.relativePath] = {
      packageId: plan.packageId,
      targetId: action.targetId,
      installedHash: action.contentHash,
    };
  }

  const manifest: InstallManifest = { version: 1, files };
  await atomicWrite(plan.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, plan.target);
  return {
    applied: true,
    target: plan.target,
    created,
    updated,
    unchanged,
    backups,
    manifestPath: plan.manifestPath,
  };
}

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export class SafePathError extends Error {}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Reject existing symlink components; absent trailing components are permitted. */
export async function assertNoSymlinkPath(path: string, label = "workspace path"): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new SafePathError(`Refusing symlink in ${label} ${JSON.stringify(current)}.`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

/** Resolve a relative path and prove it remains within a non-symlink workspace. */
export async function safeWorkspacePath(root: string, relativePath: string, label = "workspace path"): Promise<string> {
  if (isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new SafePathError(`Refusing unsafe ${label} ${JSON.stringify(relativePath)}.`);
  }
  // The chosen workspace itself may be reached through a normal OS-level
  // alias such as /var -> /private/var. Canonicalize that launch boundary,
  // then reject symlinks only within the resulting workspace tree.
  const workspace = await realpath(resolve(root));
  const destination = resolve(workspace, relativePath);
  if (!destination.startsWith(`${workspace}${sep}`)) {
    throw new SafePathError(`Refusing ${label} outside workspace ${JSON.stringify(relativePath)}.`);
  }
  await assertNoSymlinkPath(workspace, label);
  await assertNoSymlinkPath(destination, label);
  return destination;
}

/** Create a new file without following a final symlink or overwriting an existing target. */
export async function writeNewText(path: string, content: string, mode: number, label = "workspace path"): Promise<void> {
  const parent = dirname(path);
  await assertNoSymlinkPath(parent, label);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(parent, label);
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Replace an existing regular-file path atomically after rechecking its parent boundary. */
export async function replaceTextAtomically(path: string, content: string, mode: number, label = "workspace path"): Promise<void> {
  const parent = dirname(path);
  await assertNoSymlinkPath(parent, label);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(parent, label);
  const temporary = join(parent, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoSymlinkPath(parent, label);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

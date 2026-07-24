import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";

/**
 * Deliberately small, credential-free global configuration. Project packages
 * remain the source of truth for work; this only supplies CLI defaults.
 */
export const UserPreferencesSchema = z
  .object({
    version: z.literal(1),
    defaultTarget: z.string().min(1).optional(),
  })
  .strict();
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = { version: 1 };

export class PreferencesError extends Error {}

async function assertNoSymlinkPath(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = `${current}${current.endsWith(sep) ? "" : sep}${segment}`;
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new PreferencesError(`Refusing symlink in preferences path ${JSON.stringify(current)}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export interface LoadedPreferences {
  readonly preferences: UserPreferences;
  readonly exists: boolean;
}

/** Read only regular files and reject unknown fields rather than accepting secrets. */
export async function readUserPreferences(path: string): Promise<LoadedPreferences> {
  const file = resolve(path);
  await assertNoSymlinkPath(file);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { preferences: DEFAULT_USER_PREFERENCES, exists: false };
    }
    throw new PreferencesError(`Could not read preferences ${JSON.stringify(file)}: ${String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new PreferencesError(`Preferences ${JSON.stringify(file)} contain invalid JSON: ${String(error)}`);
  }
  const parsed = UserPreferencesSchema.safeParse(value);
  if (!parsed.success) {
    throw new PreferencesError(
      `Preferences ${JSON.stringify(file)} do not match the supported credential-free schema: ${parsed.error.issues[0]?.message ?? "invalid value"}.`,
    );
  }
  return { preferences: parsed.data, exists: true };
}

/**
 * Writes a mode-0600 JSON file atomically. Symlink checks fail closed; Node
 * does not offer an openat/no-follow primitive, so this cannot eliminate a
 * hostile concurrent filesystem race.
 */
export async function writeUserPreferences(path: string, preferences: UserPreferences): Promise<string> {
  const parsed = UserPreferencesSchema.parse(preferences);
  const file = resolve(path);
  const parent = dirname(file);
  await assertNoSymlinkPath(parent);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(parent);
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoSymlinkPath(parent);
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error instanceof PreferencesError
      ? error
      : new PreferencesError(`Could not write preferences ${JSON.stringify(file)}: ${String(error)}`);
  }
  return file;
}

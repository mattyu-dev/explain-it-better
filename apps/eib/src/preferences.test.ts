import { lstat, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  PreferencesError,
  readUserPreferences,
  writeUserPreferences,
} from "./preferences.js";

describe("user preferences", () => {
  it("uses a credential-free default when no file exists and writes a private JSON file", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-preferences-"));
    const file = join(root, "nested", "preferences.json");
    try {
      await expect(readUserPreferences(file)).resolves.toEqual({
        preferences: DEFAULT_USER_PREFERENCES,
        exists: false,
      });
      await expect(writeUserPreferences(file, { version: 1, defaultTarget: "openai-gpt-5.6-api" }))
        .resolves.toBe(file);
      await expect(readUserPreferences(file)).resolves.toEqual({
        preferences: { version: 1, defaultTarget: "openai-gpt-5.6-api" },
        exists: true,
      });
      expect((await lstat(file)).mode & 0o077).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for unsupported fields and symlink paths", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-preferences-"));
    const invalid = join(root, "invalid.json");
    const linked = join(root, "linked.json");
    try {
      await writeFile(invalid, '{"version":1,"token":"not-supported"}\n', "utf8");
      await expect(readUserPreferences(invalid)).rejects.toBeInstanceOf(PreferencesError);
      await symlink(invalid, linked);
      await expect(readUserPreferences(linked)).rejects.toBeInstanceOf(PreferencesError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

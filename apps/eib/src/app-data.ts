import { homedir } from "node:os";
import { join } from "node:path";

export interface AppDataPaths {
  preferencesFile: string;
  knowledgeCacheDirectory: string;
}

export interface AppDataPathOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Returns platform-standard, credential-free locations. Project packages stay
 * in `.eib/`; these global paths are only for preferences and reviewed-doc
 * cache material.
 */
export function resolveAppDataPaths(options: AppDataPathOptions = {}): AppDataPaths {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;

  if (platform === "darwin") {
    const root = join(homeDirectory, "Library", "Application Support", "explain-it-better");
    return {
      preferencesFile: join(root, "preferences.json"),
      knowledgeCacheDirectory: join(root, "knowledge-cache"),
    };
  }

  if (platform === "win32") {
    const root = join(
      environment["LOCALAPPDATA"] ?? join(homeDirectory, "AppData", "Local"),
      "explain-it-better",
    );
    return {
      preferencesFile: join(root, "preferences.json"),
      knowledgeCacheDirectory: join(root, "knowledge-cache"),
    };
  }

  const configRoot = environment["XDG_CONFIG_HOME"] ?? join(homeDirectory, ".config");
  const cacheRoot = environment["XDG_CACHE_HOME"] ?? join(homeDirectory, ".cache");
  return {
    preferencesFile: join(configRoot, "explain-it-better", "preferences.json"),
    knowledgeCacheDirectory: join(cacheRoot, "explain-it-better", "knowledge"),
  };
}

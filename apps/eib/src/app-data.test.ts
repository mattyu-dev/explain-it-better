import { describe, expect, it } from "vitest";
import { resolveAppDataPaths } from "./app-data.js";

describe("application data paths", () => {
  it("uses Application Support on macOS", () => {
    expect(
      resolveAppDataPaths({
        platform: "darwin",
        homeDirectory: "/Users/example",
        environment: {},
      }),
    ).toEqual({
      preferencesFile:
        "/Users/example/Library/Application Support/explain-it-better/preferences.json",
      knowledgeCacheDirectory:
        "/Users/example/Library/Application Support/explain-it-better/knowledge-cache",
    });
  });

  it("honors XDG locations without including a credential store", () => {
    const paths = resolveAppDataPaths({
      platform: "linux",
      homeDirectory: "/home/example",
      environment: {
        XDG_CONFIG_HOME: "/config",
        XDG_CACHE_HOME: "/cache",
      },
    });
    expect(paths.preferencesFile).toBe("/config/explain-it-better/preferences.json");
    expect(paths.knowledgeCacheDirectory).toBe("/cache/explain-it-better/knowledge");
    expect(JSON.stringify(paths)).not.toMatch(/credential|secret|token/iu);
  });
});

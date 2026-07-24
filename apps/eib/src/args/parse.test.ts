import { describe, expect, it } from "vitest";
import { parseArgs } from "./parse.js";
import { UsageError } from "./types.js";

describe("parseArgs", () => {
  it("opens the TUI without arguments", () => {
    expect(parseArgs([])).toEqual({ name: "tui", global: { json: false } });
  });

  it("accepts repeated target options and global JSON anywhere", () => {
    expect(
      parseArgs([
        "compile",
        "work/package.json",
        "--target",
        "openai:gpt",
        "--json",
        "--target=kimi:k3",
      ]),
    ).toEqual({
      name: "compile",
      global: { json: true },
      packagePath: "work/package.json",
      targets: ["openai:gpt", "kimi:k3"],
    });
  });

  it("parses and validates a prompt output schema", () => {
    expect(
      parseArgs([
        "new",
        "Extract the title",
        "--schema",
        '{"type":"object","properties":{"title":{"type":"string"}}}',
      ]),
    ).toMatchObject({
      name: "new",
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
      },
    });
  });

  it("rejects malformed schema JSON before command execution", () => {
    expect(() => parseArgs(["new", "Brief", "--schema", "{nope"])).toThrow(
      "--schema must contain valid JSON",
    );
  });

  it("rejects schema arrays because the output schema must be an object", () => {
    expect(() => parseArgs(["new", "Brief", "--schema", "[]"])).toThrow(
      "--schema must be a JSON object",
    );
  });

  it("rejects retired runtime configuration options", () => {
    expect(() => parseArgs(["new", "Brief", "--tools", "[]"])).toThrow(
      "Unknown option: --tools",
    );
    expect(() => parseArgs(["new", "Brief", "--mcp-servers", "[]"])).toThrow(
      "Unknown option: --mcp-servers",
    );
  });

  it("requires explicit execution consent for proxy evaluation", () => {
    expect(() =>
      parseArgs(["eval", "package.json", "--mode", "proxy", "--backend", "codex"]),
    ).toThrowError(
      new UsageError("proxy evaluation requires explicit --allow-execution"),
    );
  });

  it("parses unavailable live mode without pretending a proxy backend can execute it", () => {
    expect(parseArgs(["eval", "--mode=live"])).toMatchObject({
      name: "eval",
      packagePath: ".eib/package.json",
      mode: "live",
      depth: "default",
      allowExecution: false,
    });
    expect(() =>
      parseArgs(["eval", "--mode=live", "--backend", "claude"]),
    ).toThrow("--backend selects a proxy evaluator");
    expect(() =>
      parseArgs(["eval", "--mode=live", "--allow-execution"]),
    ).toThrow("--allow-execution is not accepted");
  });

  it("maps evaluation depth without weakening consent requirements", () => {
    expect(parseArgs([
      "eval",
      "--mode",
      "proxy",
      "--backend",
      "codex",
      "--allow-execution",
      "--depth",
      "deep",
    ])).toMatchObject({
      name: "eval",
      mode: "proxy",
      depth: "deep",
      allowExecution: true,
    });
    expect(() => parseArgs(["eval", "--depth", "deep"])).toThrow(
      "--depth is only valid for proxy or live evaluation",
    );
  });

  it("accepts fixture files only for static evaluation", () => {
    expect(parseArgs(["eval", "--fixtures", "outputs.json"])).toMatchObject({
      name: "eval",
      mode: "static",
      fixtures: "outputs.json",
    });
    expect(() =>
      parseArgs([
        "eval",
        "--mode",
        "proxy",
        "--backend",
        "codex",
        "--allow-execution",
        "--fixtures",
        "outputs.json",
      ]),
    ).toThrow("--fixtures is only valid for static evaluation");
  });

  it("rejects external-execution options in static mode", () => {
    expect(() =>
      parseArgs(["eval", "--mode", "static", "--backend", "codex"]),
    ).toThrow("--backend is only valid for proxy or live evaluation");
    expect(() =>
      parseArgs(["eval", "--allow-execution"]),
    ).toThrow("--allow-execution is only valid for proxy or live evaluation");
  });

  it("rejects retired agent-runtime commands", () => {
    expect(() => parseArgs(["install", "package.json"])).toThrow("Unknown command: install");
    expect(() => parseArgs(["approve", "package"])).toThrow("Unknown command: approve");
  });

  it("parses the minimal credential-free preferences workflow", () => {
    expect(parseArgs(["preferences"])).toEqual({
      name: "preferences",
      global: { json: false },
      action: "show",
    });
    expect(parseArgs([
      "preferences",
      "set",
      "--default-target",
      "openai-gpt-5.6-api",
    ])).toMatchObject({
      name: "preferences",
      action: "set",
      defaultTarget: "openai-gpt-5.6-api",
    });
    expect(() => parseArgs(["preferences", "set"])).toThrow(
      "preferences set requires --default-target",
    );
    expect(() => parseArgs(["preferences", "unset", "--default-target", "target"])).toThrow(
      "preferences unset does not accept --default-target",
    );
  });

  it("parses a conservative candidate optimization workflow", () => {
    expect(parseArgs(["optimize", "package", "--max-candidates", "2"])).toEqual({
      name: "optimize",
      global: { json: false },
      packagePath: "package",
      maxCandidates: 2,
    });
    expect(parseArgs([
      "optimize",
      "package",
      "--runs",
      "runs.json",
      "--comparisons",
      "comparisons.json",
      "--minimum-improvement",
      "0.05",
      "--output",
      "evidence.json",
    ])).toMatchObject({
      name: "optimize",
      packagePath: "package",
      maxCandidates: 3,
      runs: "runs.json",
      comparisons: "comparisons.json",
      minimumImprovement: 0.05,
      output: "evidence.json",
    });
    expect(() => parseArgs(["optimize", "--max-candidates", "4"])).toThrow(
      "--max-candidates must be 1, 2, or 3",
    );
    expect(() => parseArgs(["optimize", "--comparisons", "comparisons.json"])).toThrow(
      "--comparisons requires --runs",
    );
    expect(() => parseArgs(["optimize", "--runs", "runs.json", "--minimum-improvement", "-1"])).toThrow(
      "--minimum-improvement must be a finite non-negative number",
    );
  });

  it("rejects JSON mode for the interactive TUI", () => {
    expect(() => parseArgs(["--json"])).toThrow("--json requires a non-interactive command");
  });

  it("rejects unknown options", () => {
    expect(() => parseArgs(["doctor", "--unsafe"])).toThrow(
      "Unknown option: --unsafe",
    );
  });
});

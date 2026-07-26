import { describe, expect, it } from "vitest";
import { parseArgs } from "./parse.js";
import { UsageError } from "./types.js";

describe("parseArgs", () => {
  it("parses a proposal-only knowledge refresh", () => {
    expect(parseArgs([
      "knowledge",
      "refresh",
      "--source",
      "openai-codex-docs",
      "--output",
      "review.json",
    ])).toEqual({
      name: "knowledge",
      global: { json: false },
      action: "refresh",
      sourceIds: ["openai-codex-docs"],
      output: "review.json",
    });
    expect(() => parseArgs(["knowledge", "activate"])).toThrow(
      "knowledge requires check, stage, or refresh",
    );
  });

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

  it("requires the isolated OpenAI backend and explicit consent for live target evaluation", () => {
    expect(parseArgs(["eval", "--mode=live", "--backend=openai", "--allow-execution"])).toMatchObject({
      name: "eval",
      packagePath: ".eib/package.json",
      mode: "live",
      depth: "default",
      backend: "openai",
      allowExecution: true,
    });
    expect(() =>
      parseArgs(["eval", "--mode=live", "--backend", "claude"]),
    ).toThrow("live evaluation requires --backend openai");
    expect(() =>
      parseArgs(["eval", "--mode=live", "--backend", "openai"]),
    ).toThrow("live evaluation requires explicit --allow-execution");
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

  it("parses project-runtime installation and transforms", () => {
    expect(parseArgs(["install"])).toEqual({ name: "install", global: { json: false } });
    expect(parseArgs([
      "transform",
      "review the architecture",
      "--runtime",
      "auto",
      "--deep",
      "--for",
      "anthropic-claude-code-sonnet-5",
    ])).toEqual({
      name: "transform",
      global: { json: false },
      brief: "review the architecture",
      runtime: "auto",
      deep: true,
      explicitTarget: "anthropic-claude-code-sonnet-5",
    });
    expect(parseArgs(["confirm", "c6e75c8d-2cb5-4c02-8775-e833c2b028fd"])).toMatchObject({
      name: "confirm",
    });
    expect(() => parseArgs(["transform", "request", "--runtime", "codex"])).toThrow(
      "only --runtime auto",
    );
  });

  it("rejects retired agent-runtime commands", () => {
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

  it("requires named-backend consent before it can execute all candidates", () => {
    expect(() =>
      parseArgs(["optimize", "package", "--backend", "openai"]),
    ).toThrow("candidate execution requires explicit --allow-execution");
    expect(parseArgs([
      "optimize",
      "package",
      "--target",
      "openai-gpt-5.6-api",
      "--backend",
      "openai",
      "--allow-execution",
      "--depth",
      "deep",
    ])).toMatchObject({
      name: "optimize",
      packagePath: "package",
      target: "openai-gpt-5.6-api",
      backend: "openai",
      allowExecution: true,
      depth: "deep",
    });
    expect(() =>
      parseArgs(["optimize", "package", "--allow-execution"]),
    ).toThrow("--allow-execution requires --backend");
    expect(() =>
      parseArgs(["optimize", "package", "--backend", "openai", "--allow-execution", "--runs", "runs.json"]),
    ).toThrow("--backend cannot be combined with imported --runs evidence");
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

import { describe, expect, it } from "vitest";
import { parseArgs } from "./parse.js";
import { UsageError } from "./types.js";

describe("parseArgs", () => {
  it("parses an explicit safe refresh of project runtime assets", () => {
    expect(parseArgs(["install", "--update"])).toEqual({
      name: "install",
      global: { json: false },
      update: true,
    });
    expect(parseArgs(["install"])).toEqual({
      name: "install",
      global: { json: false },
      update: false,
    });
  });

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
      "knowledge requires check, stage, refresh, or promote-plan",
    );
  });

  it("parses a non-active promotion dossier request", () => {
    expect(parseArgs([
      "knowledge",
      "promote-plan",
      "anthropic/claude-opus-5",
      "--from",
      "refresh.json",
      "--output",
      "opus-plan.json",
    ])).toEqual({
      name: "knowledge",
      global: { json: false },
      action: "promote-plan",
      candidate: "anthropic/claude-opus-5",
      proposalPath: "refresh.json",
      output: "opus-plan.json",
      sourceIds: [],
    });
    expect(() => parseArgs(["knowledge", "promote-plan", "claude-opus-5"])).toThrow(
      "knowledge promote-plan requires <provider/model>",
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
    expect(parseArgs(["eval", "--mode=live", "--backend=openai", "--allow-execution", "--fixtures", "outputs.json"])).toMatchObject({
      name: "eval",
      packagePath: ".eib/package.json",
      mode: "live",
      depth: "default",
      backend: "openai",
      fixtures: "outputs.json",
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
      "--fixtures",
      "outputs.json",
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

  it("requires fixture files for external evaluation so static validation is fresh", () => {
    expect(parseArgs(["eval", "--fixtures", "outputs.json"])).toMatchObject({
      name: "eval",
      mode: "static",
      fixtures: "outputs.json",
    });
    expect(parseArgs([
      "eval",
      "--mode",
      "proxy",
      "--backend",
      "codex",
      "--allow-execution",
      "--fixtures",
      "outputs.json",
    ])).toMatchObject({ mode: "proxy", fixtures: "outputs.json" });
    expect(() => parseArgs([
      "eval",
      "--mode",
      "proxy",
      "--backend",
      "codex",
      "--allow-execution",
    ])).toThrow("requires --fixtures");
  });

  it("requires complete local evidence and a new receipt destination for proof", () => {
    expect(parseArgs([
      "prove",
      "package",
      "--fixtures",
      "outputs.json",
      "--output",
      ".eib/proofs/receipt.json",
    ])).toEqual({
      name: "prove",
      global: { json: false },
      packagePath: "package",
      fixtures: "outputs.json",
      output: ".eib/proofs/receipt.json",
    });
    expect(() => parseArgs(["prove", "package", "--output", "receipt.json"])).toThrow(
      "prove requires --fixtures",
    );
    expect(() => parseArgs(["prove", "package", "--fixtures", "outputs.json"])).toThrow(
      "prove requires --output",
    );
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
    expect(parseArgs(["install"])).toEqual({ name: "install", global: { json: false }, update: false });
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

  it("parses a guided quickstart as a confirmation-gated preview", () => {
    expect(parseArgs(["quickstart"])).toEqual({
      name: "quickstart",
      global: { json: false },
      brief: "Review this project's architecture and deliver a prioritized Markdown list of concrete next steps for a maintainer.",
      deep: false,
      usingExample: true,
    });
    expect(parseArgs([
      "quickstart",
      "Review the API boundary",
      "--deep",
      "--for",
      "openai-gpt-5.6-codex",
    ])).toEqual({
      name: "quickstart",
      global: { json: false },
      brief: "Review the API boundary",
      deep: true,
      usingExample: false,
      explicitTarget: "openai-gpt-5.6-codex",
    });
    expect(() => parseArgs(["quickstart", "request", "--brief", "another request"])).toThrow(
      "Provide the request either positionally or with --brief, not both",
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

  it("parses the remaining non-interactive command variants", () => {
    expect(parseArgs(["--version"])).toEqual({
      name: "version",
      global: { json: false },
    });
    expect(parseArgs(["--help", "optimize"])).toEqual({
      name: "help",
      global: { json: false },
      topic: "optimize",
    });
    expect(parseArgs(["new", "--fast", "--target", "openai:gpt", "--output", "draft.md"])).toEqual({
      name: "new",
      global: { json: false },
      fast: true,
      targets: ["openai:gpt"],
      output: "draft.md",
    });
    expect(parseArgs(["improve", "package.json", "--fast", "--feedback", "be concise", "--output", "next.json"])).toEqual({
      name: "improve",
      global: { json: false },
      packagePath: "package.json",
      feedback: "be concise",
      fast: true,
      output: "next.json",
    });
    expect(parseArgs(["doctor"])).toEqual({ name: "doctor", global: { json: false } });
  });

  it("enforces command boundaries for version, help, and positional arguments", () => {
    expect(() => parseArgs(["--version", "doctor"])).toThrow(
      "--version cannot be combined with a command",
    );
    expect(() => parseArgs(["--version=1"])).toThrow("does not accept a value");
    expect(() => parseArgs(["install", "unexpected"])).toThrow(
      "install does not accept positional arguments",
    );
    expect(() => parseArgs(["confirm"])).toThrow("confirm requires exactly one run token");
    expect(() => parseArgs(["doctor", "unexpected"])).toThrow(
      "doctor does not accept positional arguments",
    );
  });

  it("parses export formats and rejects unsafe format/output combinations", () => {
    expect(parseArgs(["export", "package.json", "--format", "directory", "--output", "bundle"])).toEqual({
      name: "export",
      global: { json: false },
      packagePath: "package.json",
      format: "directory",
      output: "bundle",
    });
    expect(parseArgs(["export", "--format", "clipboard"])).toEqual({
      name: "export",
      global: { json: false },
      packagePath: ".eib/package.json",
      format: "clipboard",
    });
    expect(() => parseArgs(["export"])).toThrow("directory export requires --output");
    expect(() => parseArgs(["export", "--format", "clipboard", "--output", "bundle"])).toThrow(
      "--output is not valid for clipboard export",
    );
    expect(() => parseArgs(["export", "--format", "zip", "--output", "bundle"])).toThrow(
      "--format must be directory or clipboard",
    );
  });

  it("rejects invalid optimization evidence and backend combinations", () => {
    expect(() => parseArgs(["optimize", "--minimum-improvement", "0.1"])).toThrow(
      "--minimum-improvement requires --runs or --backend",
    );
    expect(() => parseArgs(["optimize", "--backend", "other", "--allow-execution"])).toThrow(
      "--backend must be codex, claude, or openai",
    );
    expect(() => parseArgs(["optimize", "--backend", "codex", "--allow-execution", "--comparisons", "comparisons.json"])).toThrow(
      "--comparisons requires --runs",
    );
    expect(() => parseArgs(["optimize", "--backend", "codex", "--allow-execution", "--depth", "slow"])).toThrow(
      "--depth must be quick, default, or deep",
    );
    expect(() => parseArgs(["optimize", "one", "two"])).toThrow(
      "optimize accepts at most one package path",
    );
  });

  it("rejects invalid external evaluation contracts before execution", () => {
    expect(() => parseArgs(["eval", "--mode", "other"])).toThrow(
      "--mode must be static, proxy, or live",
    );
    expect(() => parseArgs(["eval", "--mode", "proxy", "--backend", "openai", "--allow-execution", "--fixtures", "out.json"])).toThrow(
      "proxy evaluation requires --backend codex|claude",
    );
    expect(() => parseArgs(["eval", "--mode", "static", "--depth", "quick"])).toThrow(
      "--depth is only valid for proxy or live evaluation",
    );
    expect(() => parseArgs(["eval", "--mode", "live", "--backend", "openai", "--allow-execution"])).toThrow(
      "proxy or live evaluation requires --fixtures",
    );
    expect(() => parseArgs(["eval", "--mode", "proxy", "--backend", "codex", "--allow-execution", "--fixtures", "out.json", "--depth", "slow"])).toThrow(
      "--depth must be quick, default, or deep",
    );
  });
});

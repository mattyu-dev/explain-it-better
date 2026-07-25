import { IntentContractSchema } from "@eib/core";
import type {
  CandidateCount,
  CliCommand,
  EvalMode,
  GlobalOptions,
} from "./types.js";
import { UsageError } from "./types.js";

interface ParsedTokens {
  positionals: string[];
  options: Map<string, string[]>;
  flags: Set<string>;
}

const VALUE_OPTIONS = new Set([
  "backend",
  "brief",
  "default-target",
  "depth",
  "feedback",
  "fixtures",
  "format",
  "mode",
  "minimum-improvement",
  "output",
  "runs",
  "comparisons",
  "max-candidates",
  "schema",
  "source",
  "target",
  "for",
  "runtime",
]);

const FLAG_OPTIONS = new Set([
  "allow-execution",
  "deep",
  "fast",
  "help",
  "json",
  "version",
]);

function tokenize(argv: readonly string[]): ParsedTokens {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (positionalOnly) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (token === "-h") {
      flags.add("help");
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const separator = token.indexOf("=");
    const name = token.slice(2, separator === -1 ? undefined : separator);
    if (FLAG_OPTIONS.has(name)) {
      if (separator !== -1) {
        throw new UsageError(`--${name} does not accept a value`);
      }
      flags.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      throw new UsageError(`Unknown option: --${name}`);
    }

    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw new UsageError(`--${name} requires a value`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    const values = options.get(name) ?? [];
    values.push(value);
    options.set(name, values);
  }

  return { positionals, options, flags };
}

function one(parsed: ParsedTokens, name: string): string | undefined {
  const values = parsed.options.get(name);
  if (values === undefined) {
    return undefined;
  }
  if (values.length !== 1) {
    throw new UsageError(`--${name} may only be specified once`);
  }
  return values[0];
}

function many(parsed: ParsedTokens, name: string): string[] {
  return [...(parsed.options.get(name) ?? [])];
}

function parseJson(raw: string, option: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`--${option} must contain valid JSON: ${reason}`);
  }
}

function parseCandidateCount(value: string | undefined): CandidateCount {
  if (value === undefined) return 3;
  if (value === "1" || value === "2" || value === "3") {
    return Number(value) as CandidateCount;
  }
  throw new UsageError("--max-candidates must be 1, 2, or 3");
}

function parseNonNegativeNumber(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (value.trim().length === 0 || !Number.isFinite(number) || number < 0) {
    throw new UsageError(`--${option} must be a finite non-negative number`);
  }
  return number;
}

function parseOutputSchema(
  parsed: ParsedTokens,
): NonNullable<
  Extract<CliCommand, { name: "new" }>["outputSchema"]
> | undefined {
  const raw = one(parsed, "schema");
  if (raw === undefined) {
    return undefined;
  }
  const result =
    IntentContractSchema.shape.outputContract.shape.schema.safeParse(
      parseJson(raw, "schema"),
    );
  if (!result.success || result.data === undefined) {
    const reason = result.success
      ? "the value must be a JSON object"
      : result.error.issues[0]?.message ?? "the value does not match the output schema contract";
    throw new UsageError(`--schema must be a JSON object: ${reason}`);
  }
  return result.data;
}

function rejectOptions(
  parsed: ParsedTokens,
  allowedValues: readonly string[],
  allowedFlags: readonly string[],
): void {
  const allowedValueSet = new Set(allowedValues);
  const allowedFlagSet = new Set(["help", "json", ...allowedFlags]);
  for (const name of parsed.options.keys()) {
    if (!allowedValueSet.has(name)) {
      throw new UsageError(`--${name} is not valid for this command`);
    }
  }
  for (const name of parsed.flags) {
    if (!allowedFlagSet.has(name)) {
      throw new UsageError(`--${name} is not valid for this command`);
    }
  }
}

function packagePath(positionals: string[], command: string): string {
  if (positionals.length > 1) {
    throw new UsageError(`${command} accepts at most one package path`);
  }
  return positionals[0] ?? ".eib/package.json";
}

export function parseArgs(argv: readonly string[]): CliCommand {
  const parsed = tokenize(argv);
  const global: GlobalOptions = { json: parsed.flags.has("json") };
  const commandName = parsed.positionals.shift();

  if (parsed.flags.has("version")) {
    if (commandName !== undefined) {
      throw new UsageError("--version cannot be combined with a command");
    }
    rejectOptions(parsed, [], ["version"]);
    return { name: "version", global };
  }

  if (parsed.flags.has("help")) {
    return { name: "help", global, ...(commandName === undefined ? {} : { topic: commandName }) };
  }

  switch (commandName) {
    case undefined:
      rejectOptions(parsed, [], []);
      if (global.json) {
        throw new UsageError("--json requires a non-interactive command");
      }
      return { name: "tui", global };
    case "install":
      rejectOptions(parsed, [], []);
      if (parsed.positionals.length !== 0) {
        throw new UsageError("install does not accept positional arguments");
      }
      return { name: "install", global };
    case "transform": {
      rejectOptions(parsed, ["brief", "runtime", "for"], ["deep"]);
      const explicitBrief = one(parsed, "brief");
      const positionalBrief = parsed.positionals.join(" ").trim() || undefined;
      if (explicitBrief !== undefined && positionalBrief !== undefined) {
        throw new UsageError("Provide the request either positionally or with --brief, not both");
      }
      const brief = explicitBrief ?? positionalBrief;
      const runtime = one(parsed, "runtime") ?? "auto";
      if (runtime !== "auto") {
        throw new UsageError("transform currently supports only --runtime auto");
      }
      const explicitTarget = one(parsed, "for");
      return {
        name: "transform",
        global,
        ...(brief === undefined
          ? {}
          : { brief }),
        runtime: "auto",
        deep: parsed.flags.has("deep"),
        ...(explicitTarget === undefined ? {} : { explicitTarget }),
      };
    }
    case "confirm": {
      rejectOptions(parsed, [], []);
      if (parsed.positionals.length !== 1) {
        throw new UsageError("confirm requires exactly one run token");
      }
      return { name: "confirm", global, token: parsed.positionals[0]! };
    }
    case "new": {
      rejectOptions(
        parsed,
        ["brief", "output", "schema", "target"],
        ["fast"],
      );
      const explicitBrief = one(parsed, "brief");
      const positionalBrief = parsed.positionals.join(" ").trim() || undefined;
      if (explicitBrief !== undefined && positionalBrief !== undefined) {
        throw new UsageError("Provide the brief either positionally or with --brief, not both");
      }
      const brief = explicitBrief ?? positionalBrief;
      const output = one(parsed, "output");
      const outputSchema = parseOutputSchema(parsed);
      return {
        name: "new",
        global,
        ...(brief === undefined ? {} : { brief }),
        fast: parsed.flags.has("fast"),
        targets: many(parsed, "target"),
        ...(output === undefined ? {} : { output }),
        ...(outputSchema === undefined ? {} : { outputSchema }),
      };
    }
    case "improve": {
      rejectOptions(parsed, ["feedback", "output"], ["fast"]);
      if (parsed.positionals.length !== 1) {
        throw new UsageError("improve requires exactly one package path");
      }
      const feedback = one(parsed, "feedback");
      const output = one(parsed, "output");
      return {
        name: "improve",
        global,
        packagePath: parsed.positionals[0]!,
        ...(feedback === undefined ? {} : { feedback }),
        fast: parsed.flags.has("fast"),
        ...(output === undefined ? {} : { output }),
      };
    }
    case "optimize": {
      rejectOptions(
        parsed,
        ["runs", "comparisons", "max-candidates", "minimum-improvement", "output", "target", "backend", "depth"],
        ["allow-execution"],
      );
      const runs = one(parsed, "runs");
      const comparisons = one(parsed, "comparisons");
      const output = one(parsed, "output");
      const target = one(parsed, "target");
      const backend = one(parsed, "backend");
      const depthValue = one(parsed, "depth");
      if (comparisons !== undefined && runs === undefined) {
        throw new UsageError("--comparisons requires --runs");
      }
      if (one(parsed, "minimum-improvement") !== undefined && runs === undefined) {
        if (backend === undefined) {
          throw new UsageError("--minimum-improvement requires --runs or --backend");
        }
      }
      if (backend !== undefined && backend !== "codex" && backend !== "claude" && backend !== "openai") {
        throw new UsageError("--backend must be codex, claude, or openai");
      }
      if (backend !== undefined && runs !== undefined) {
        throw new UsageError("--backend cannot be combined with imported --runs evidence");
      }
      if (backend !== undefined && comparisons !== undefined) {
        throw new UsageError("--backend cannot be combined with imported --comparisons evidence");
      }
      if (backend !== undefined && !parsed.flags.has("allow-execution")) {
        throw new UsageError("candidate execution requires explicit --allow-execution");
      }
      if (backend === undefined && parsed.flags.has("allow-execution")) {
        throw new UsageError("--allow-execution requires --backend codex|claude|openai");
      }
      if (backend === undefined && depthValue !== undefined) {
        throw new UsageError("--depth requires --backend codex|claude|openai");
      }
      if (depthValue !== undefined && !["quick", "default", "deep"].includes(depthValue)) {
        throw new UsageError("--depth must be quick, default, or deep");
      }
      const minimumImprovement = parseNonNegativeNumber(
        one(parsed, "minimum-improvement"),
        "minimum-improvement",
      );
      return {
        name: "optimize",
        global,
        packagePath: packagePath(parsed.positionals, "optimize"),
        maxCandidates: parseCandidateCount(one(parsed, "max-candidates")),
        ...(target === undefined ? {} : { target }),
        ...(backend === undefined ? {} : { backend }),
        ...(depthValue === undefined ? {} : { depth: depthValue as "quick" | "default" | "deep" }),
        ...(backend === undefined ? {} : { allowExecution: true }),
        ...(runs === undefined ? {} : { runs }),
        ...(comparisons === undefined ? {} : { comparisons }),
        ...(minimumImprovement === undefined ? {} : { minimumImprovement }),
        ...(output === undefined ? {} : { output }),
      };
    }
    case "compile": {
      rejectOptions(parsed, ["output", "target"], []);
      const targets = many(parsed, "target");
      if (targets.length === 0) {
        throw new UsageError("compile requires at least one --target");
      }
      const output = one(parsed, "output");
      return {
        name: "compile",
        global,
        packagePath: packagePath(parsed.positionals, "compile"),
        targets,
        ...(output === undefined ? {} : { output }),
      };
    }
    case "eval": {
      rejectOptions(parsed, ["backend", "depth", "fixtures", "mode"], ["allow-execution"]);
      const modeValue = one(parsed, "mode") ?? "static";
      if (!["static", "proxy", "live"].includes(modeValue)) {
        throw new UsageError("--mode must be static, proxy, or live");
      }
      const depth = one(parsed, "depth") ?? "default";
      if (!["quick", "default", "deep"].includes(depth)) {
        throw new UsageError("--depth must be quick, default, or deep");
      }
      const backend = one(parsed, "backend");
      const fixtures = one(parsed, "fixtures");
      if (backend !== undefined && backend !== "codex" && backend !== "claude" && backend !== "openai") {
        throw new UsageError("--backend must be codex, claude, or openai");
      }
      if (modeValue === "proxy" && !parsed.flags.has("allow-execution")) {
        throw new UsageError(
          "proxy evaluation requires explicit --allow-execution",
        );
      }
      if (modeValue === "proxy" && (backend === undefined || backend === "openai")) {
        throw new UsageError("proxy evaluation requires --backend codex|claude");
      }
      if (modeValue !== "static" && fixtures !== undefined) {
        throw new UsageError("--fixtures is only valid for static evaluation");
      }
      if (modeValue === "static" && backend !== undefined) {
        throw new UsageError("--backend is only valid for proxy or live evaluation");
      }
      if (modeValue === "static" && parsed.flags.has("allow-execution")) {
        throw new UsageError("--allow-execution is only valid for proxy or live evaluation");
      }
      if (modeValue === "static" && parsed.options.has("depth")) {
        throw new UsageError("--depth is only valid for proxy or live evaluation");
      }
      if (modeValue === "live" && backend !== "openai") {
        throw new UsageError("live evaluation requires --backend openai");
      }
      if (modeValue === "live" && !parsed.flags.has("allow-execution")) {
        throw new UsageError("live evaluation requires explicit --allow-execution");
      }
      return {
        name: "eval",
        global,
        packagePath: packagePath(parsed.positionals, "eval"),
        mode: modeValue as EvalMode,
        depth: depth as "quick" | "default" | "deep",
        ...(backend === undefined ? {} : { backend }),
        ...(fixtures === undefined ? {} : { fixtures }),
        allowExecution: parsed.flags.has("allow-execution"),
      };
    }
    case "export": {
      rejectOptions(parsed, ["format", "output"], []);
      const formatValue = one(parsed, "format") ?? "directory";
      if (formatValue !== "directory" && formatValue !== "clipboard") {
        throw new UsageError("--format must be directory or clipboard");
      }
      const output = one(parsed, "output");
      if (formatValue === "directory" && output === undefined) {
        throw new UsageError("directory export requires --output");
      }
      if (formatValue === "clipboard" && output !== undefined) {
        throw new UsageError("--output is not valid for clipboard export");
      }
      return {
        name: "export",
        global,
        packagePath: packagePath(parsed.positionals, "export"),
        format: formatValue,
        ...(output === undefined ? {} : { output }),
      };
    }
    case "preferences": {
      rejectOptions(parsed, ["default-target"], []);
      const action = parsed.positionals.shift() ?? "show";
      if (action !== "show" && action !== "set" && action !== "unset") {
        throw new UsageError("preferences requires show, set, or unset");
      }
      if (parsed.positionals.length !== 0) {
        throw new UsageError(`preferences ${action} does not accept positional arguments`);
      }
      const defaultTarget = one(parsed, "default-target");
      if (action === "show" && defaultTarget !== undefined) {
        throw new UsageError("--default-target is only valid for preferences set or unset");
      }
      if (action === "set" && (defaultTarget === undefined || !defaultTarget.trim())) {
        throw new UsageError("preferences set requires --default-target <id>");
      }
      if (action === "unset" && defaultTarget !== undefined) {
        throw new UsageError("preferences unset does not accept --default-target");
      }
      return {
        name: "preferences",
        global,
        action,
        ...(defaultTarget === undefined ? {} : { defaultTarget }),
      };
    }
    case "doctor":
      rejectOptions(parsed, [], []);
      if (parsed.positionals.length !== 0) {
        throw new UsageError("doctor does not accept positional arguments");
      }
      return { name: "doctor", global };
    case "knowledge": {
      rejectOptions(parsed, ["output", "source"], []);
      const action = parsed.positionals.shift();
      if (action !== "check" && action !== "stage") {
        throw new UsageError("knowledge requires check or stage");
      }
      if (parsed.positionals.length !== 0) {
        throw new UsageError(`knowledge ${action} does not accept positional arguments`);
      }
      const output = one(parsed, "output");
      return {
        name: "knowledge",
        global,
        action,
        ...(output === undefined ? {} : { output }),
        sourceIds: many(parsed, "source"),
      };
    }
    default:
      throw new UsageError(`Unknown command: ${commandName}`);
  }
}

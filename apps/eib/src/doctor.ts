import { runProcess } from "./backends/process.js";
import {
  LocalBackendError,
  type BackendId,
  type BackendRole,
} from "./backends/types.js";
import { TARGET_ONLY_SAFETY_REASONS } from "./backends/target-only.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface DoctorOptions {
  executables?: Partial<Record<BackendId, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DoctorCheck {
  id: BackendId;
  label: string;
  executable: string;
  installed: boolean;
  authenticated: boolean | null;
  compilerReady: boolean;
  role: BackendRole;
  safetyReason: string;
  version?: string;
  diagnostics: string[];
}

export interface DoctorReport {
  generatedAt: string;
  checks: DoctorCheck[];
  readyCompilerBackends: Array<"codex" | "claude">;
}

interface VersionProbe {
  installed: boolean;
  version?: string;
  diagnostic?: string;
}

function firstNonemptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

async function probeVersion(
  id: BackendId,
  executable: string,
  options: DoctorOptions,
): Promise<VersionProbe> {
  try {
    const result = await runProcess({
      backend: id,
      executable,
      args: ["--version"],
      maxOutputBytes: 64 * 1024,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const version = firstNonemptyLine(result.stdout) ?? firstNonemptyLine(result.stderr);
    return {
      installed: true,
      ...(version === undefined ? {} : { version }),
    };
  } catch (error) {
    if (error instanceof LocalBackendError && error.code === "not_found") {
      return { installed: false };
    }
    if (error instanceof LocalBackendError && error.code === "cancelled") {
      throw error;
    }
    return {
      installed: true,
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseCodexAuthentication(value: string): boolean | null {
  const normalized = value.toLowerCase();
  if (/not\s+logged\s+in|not\s+authenticated/u.test(normalized)) {
    return false;
  }
  if (/logged\s+in|authenticated/u.test(normalized)) {
    return true;
  }
  return null;
}

function parseClaudeAuthentication(value: string): boolean | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed["loggedIn"] === "boolean") {
      return parsed["loggedIn"];
    }
    if (typeof parsed["authenticated"] === "boolean") {
      return parsed["authenticated"];
    }
  } catch {
    return parseCodexAuthentication(value);
  }
  return null;
}

async function probeAuthentication(
  id: "codex" | "claude",
  executable: string,
  options: DoctorOptions,
): Promise<{ authenticated: boolean | null; diagnostic?: string }> {
  const args = id === "codex"
    ? ["login", "status"]
    : ["auth", "status", "--json"];
  try {
    const result = await runProcess({
      backend: id,
      executable,
      args,
      maxOutputBytes: 64 * 1024,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      authenticated: id === "codex"
        ? parseCodexAuthentication(output)
        : parseClaudeAuthentication(output),
    };
  } catch (error) {
    if (error instanceof LocalBackendError && error.code === "cancelled") {
      throw error;
    }
    return {
      authenticated: false,
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

async function compilerCheck(
  id: "codex" | "claude",
  executable: string,
  options: DoctorOptions,
): Promise<DoctorCheck> {
  const label = id === "codex" ? "Codex CLI" : "Claude Code";
  const version = await probeVersion(id, executable, options);
  const diagnostics = version.diagnostic === undefined ? [] : [version.diagnostic];
  if (!version.installed) {
    return {
      id,
      label,
      executable,
      installed: false,
      authenticated: null,
      compilerReady: false,
      role: "compiler",
      safetyReason: `${label} is unavailable because the executable was not found.`,
      diagnostics,
    };
  }

  const authentication = await probeAuthentication(id, executable, options);
  if (authentication.diagnostic !== undefined) {
    diagnostics.push(authentication.diagnostic);
  }
  const compilerReady = authentication.authenticated === true;
  return {
    id,
    label,
    executable,
    installed: true,
    authenticated: authentication.authenticated,
    compilerReady,
    role: "compiler",
    safetyReason: compilerReady
      ? id === "codex"
        ? "Ready through ephemeral, ignored-config, ignored-rules, read-only structured execution."
        : "Ready through print, safe-mode, no-Chrome, no-persistence, zero-tool structured execution."
      : `${label} is installed but no authenticated local session was confirmed.`,
    ...(version.version === undefined ? {} : { version: version.version }),
    diagnostics,
  };
}

async function targetOnlyCheck(
  id: "hermes" | "kimi",
  executable: string,
  options: DoctorOptions,
): Promise<DoctorCheck> {
  const version = await probeVersion(id, executable, options);
  return {
    id,
    label: id === "hermes" ? "Hermes CLI" : "Kimi Code",
    executable,
    installed: version.installed,
    authenticated: null,
    compilerReady: false,
    role: "target_only",
    safetyReason: TARGET_ONLY_SAFETY_REASONS[id],
    ...(version.version === undefined ? {} : { version: version.version }),
    diagnostics: version.diagnostic === undefined ? [] : [version.diagnostic],
  };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const executables = {
    codex: options.executables?.codex ?? "codex",
    claude: options.executables?.claude ?? "claude",
    hermes: options.executables?.hermes ?? "hermes",
    kimi: options.executables?.kimi ?? "kimi",
  };
  const checks = await Promise.all([
    compilerCheck("codex", executables.codex, options),
    compilerCheck("claude", executables.claude, options),
    targetOnlyCheck("hermes", executables.hermes, options),
    targetOnlyCheck("kimi", executables.kimi, options),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    checks,
    readyCompilerBackends: checks
      .filter(
        (check): check is DoctorCheck & { id: "codex" | "claude" } =>
          check.compilerReady && (check.id === "codex" || check.id === "claude"),
      )
      .map((check) => check.id),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["Explain It Better doctor", ""];
  for (const check of report.checks) {
    const status = check.compilerReady
      ? "ready"
      : check.installed
        ? check.role === "target_only"
          ? "target-only"
          : "not authenticated"
        : "not installed";
    lines.push(
      `${check.label}: ${status}${check.version === undefined ? "" : ` (${check.version})`}`,
      `  ${check.safetyReason}`,
    );
    for (const diagnostic of check.diagnostics) {
      lines.push(`  Diagnostic: ${diagnostic}`);
    }
  }
  return lines.join("\n");
}

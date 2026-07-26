import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  getTargetProfile,
  targetProfiles,
  type KnowledgeTargetProfile,
} from "@eib/knowledge";

export type RuntimeAdapterId = "codex" | "claude-code" | "generic-cli";

export interface RuntimeDescriptor {
  readonly adapterId: RuntimeAdapterId;
  readonly provider: string;
  readonly model: string;
  readonly surface: string;
  readonly reasoningMode?: string;
  readonly tools: readonly string[];
  readonly permissions: readonly string[];
  /**
   * A detected host is deliberately distinct from a resolved target. When a
   * host does not expose its exact model, `model` is the non-model sentinel
   * below and resolution must stop rather than borrowing a profile default.
   */
  readonly detectionSource:
    | "native_environment"
    | "adapter_environment"
    | "native_environment_without_exact_model"
    | "adapter_environment_without_exact_model";
}

export interface RuntimeAdapterCapability {
  readonly adapterId: RuntimeAdapterId;
  readonly nativeProjectAsset: "skill" | "slash_command" | "none";
  /** How the host exposes EIB; this is not a claim of active-session injection. */
  readonly activation: "skill_discovery" | "slash_command" | "cli";
  /** Native hosts mediate the confirmed handoff; generic adapters copy the brief. */
  readonly handoff: "host_mediated" | "copy_paste";
  readonly detects: readonly string[];
  readonly providers: readonly string[];
}

export interface RuntimeTargetCapability {
  readonly targetId: string;
  readonly provider: string;
  readonly integration: "native_skill" | "native_slash_command" | "cli_adapter" | "export_only";
}

export const runtimeAdapterCapabilities: readonly RuntimeAdapterCapability[] = [
  {
    adapterId: "codex",
    nativeProjectAsset: "skill",
    activation: "skill_discovery",
    handoff: "host_mediated",
    detects: ["CODEX_THREAD_ID", "__CFBundleIdentifier=com.openai.codex"],
    providers: ["openai"],
  },
  {
    adapterId: "claude-code",
    nativeProjectAsset: "slash_command",
    activation: "slash_command",
    handoff: "host_mediated",
    detects: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    providers: ["anthropic"],
  },
  {
    adapterId: "generic-cli",
    nativeProjectAsset: "none",
    activation: "cli",
    handoff: "copy_paste",
    detects: ["EIB_RUNTIME_PROVIDER", "EIB_RUNTIME_MODEL", "EIB_RUNTIME_SURFACE"],
    providers: [...new Set(targetProfiles.map((profile) => profile.provider))],
  },
];

/** Explicitly distinguish native host integrations from CLI/export-only targets. */
export function runtimeTargetCapabilities(): RuntimeTargetCapability[] {
  return targetProfiles.map((profile) => ({
    targetId: profile.id,
    provider: profile.provider,
    integration: profile.availability === "target_only"
      ? "export_only"
      : profile.provider === "openai" && profile.surface === "coding_cli"
        ? "native_skill"
        : profile.provider === "anthropic" && profile.surface === "coding_cli"
          ? "native_slash_command"
          : "cli_adapter",
  }));
}

const ProjectRuntimeConfigSchema = z
  .object({
    version: z.literal(1),
    defaultTarget: z.string().min(1).optional(),
  })
  .strict();

export type ProjectRuntimeConfig = z.infer<typeof ProjectRuntimeConfigSchema>;

export interface RuntimeResolution {
  readonly status: "resolved" | "needs_input";
  readonly target?: KnowledgeTargetProfile;
  readonly runtime?: RuntimeDescriptor;
  readonly selectionSource?: "runtime" | "explicit_export" | "project_default";
  readonly message: string;
  readonly capabilities: readonly RuntimeAdapterCapability[];
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const UNKNOWN_RUNTIME_VALUE = "<unknown>";

function runtimeFromAdapterEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeDescriptor | undefined {
  const provider = nonEmpty(environment.EIB_RUNTIME_PROVIDER);
  const model = nonEmpty(environment.EIB_RUNTIME_MODEL);
  const surface = nonEmpty(environment.EIB_RUNTIME_SURFACE);
  const reasoningMode = nonEmpty(environment.EIB_RUNTIME_REASONING);
  if (provider === undefined && model === undefined && surface === undefined) return undefined;
  return {
    adapterId: "generic-cli",
    provider: provider ?? UNKNOWN_RUNTIME_VALUE,
    model: model ?? UNKNOWN_RUNTIME_VALUE,
    surface: surface ?? UNKNOWN_RUNTIME_VALUE,
    ...(reasoningMode === undefined
      ? {}
      : { reasoningMode }),
    tools: commaList(environment.EIB_RUNTIME_TOOLS),
    permissions: commaList(environment.EIB_RUNTIME_PERMISSIONS),
    detectionSource: model === undefined
      ? "adapter_environment_without_exact_model"
      : "adapter_environment",
  };
}

/** Detect only documented/local host markers; unknown environments never guess a provider. */
export function detectRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeDescriptor | undefined {
  const adapterRuntime = runtimeFromAdapterEnvironment(environment);
  if (adapterRuntime !== undefined) return adapterRuntime;

  if (
    nonEmpty(environment.CODEX_THREAD_ID) !== undefined ||
    environment.__CFBundleIdentifier === "com.openai.codex"
  ) {
    const reasoningMode = nonEmpty(environment.CODEX_REASONING_EFFORT);
    const model = nonEmpty(environment.CODEX_MODEL);
    return {
      adapterId: "codex",
      provider: "openai",
      model: model ?? UNKNOWN_RUNTIME_VALUE,
      surface: "coding_cli",
      ...(reasoningMode === undefined
        ? {}
        : { reasoningMode }),
      tools: ["filesystem", "terminal"],
      permissions: commaList(environment.CODEX_PERMISSION_PROFILE),
      detectionSource: model === undefined
        ? "native_environment_without_exact_model"
        : "native_environment",
    };
  }

  if (
    nonEmpty(environment.CLAUDECODE) !== undefined ||
    nonEmpty(environment.CLAUDE_CODE_ENTRYPOINT) !== undefined
  ) {
    const reasoningMode = nonEmpty(environment.CLAUDE_REASONING_MODE);
    const model = nonEmpty(environment.CLAUDE_MODEL);
    return {
      adapterId: "claude-code",
      provider: "anthropic",
      model: model ?? UNKNOWN_RUNTIME_VALUE,
      surface: "coding_cli",
      ...(reasoningMode === undefined
        ? {}
        : { reasoningMode }),
      tools: ["filesystem", "terminal"],
      permissions: commaList(environment.CLAUDE_CODE_PERMISSIONS),
      detectionSource: model === undefined
        ? "native_environment_without_exact_model"
        : "native_environment",
    };
  }
  return undefined;
}

export async function readProjectRuntimeConfig(root: string): Promise<ProjectRuntimeConfig | undefined> {
  try {
    const raw = await readFile(join(root, ".eibrc.json"), "utf8");
    const parsed = ProjectRuntimeConfigSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "invalid configuration");
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function profileForRuntime(runtime: RuntimeDescriptor): KnowledgeTargetProfile | undefined {
  const provider = runtime.provider.toLowerCase();
  const model = runtime.model.toLowerCase();
  const surface = runtime.surface.toLowerCase();
  const exact = targetProfiles.filter(
    (profile) =>
      profile.provider.toLowerCase() === provider &&
      profile.model.toLowerCase() === model &&
      profile.surface.toLowerCase() === surface,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

/** Resolve an exact target or stop before emitting target-specific guidance. */
export async function resolveRuntimeTarget(options: {
  readonly root: string;
  readonly explicitTarget?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<RuntimeResolution> {
  if (options.explicitTarget !== undefined) {
    return {
      status: "resolved",
      target: getTargetProfile(options.explicitTarget),
      message: `Using explicit export target ${options.explicitTarget}.`,
      selectionSource: "explicit_export",
      capabilities: runtimeAdapterCapabilities,
    };
  }

  const runtime = detectRuntime(options.environment);
  if (runtime !== undefined) {
    const target = profileForRuntime(runtime);
    if (target !== undefined) {
      return {
        status: "resolved",
        target,
        runtime,
        selectionSource: "runtime",
        message: `Detected ${runtime.adapterId} (${runtime.model}, ${runtime.surface}).`,
        capabilities: runtimeAdapterCapabilities,
      };
    }
    return {
      status: "needs_input",
      runtime,
      message: runtime.model === UNKNOWN_RUNTIME_VALUE
        ? `Detected ${runtime.adapterId}, but its exact active model is unavailable. Select a reviewed target with --for <target>; EIB will not apply target-specific rules by default.`
        : `Detected ${runtime.adapterId}, but no reviewed target profile matches ${runtime.provider} ${runtime.model} on ${runtime.surface}. Use --for <target>.`,
      capabilities: runtimeAdapterCapabilities,
    };
  }

  const config = await readProjectRuntimeConfig(options.root);
  if (config?.defaultTarget !== undefined) {
    return {
      status: "resolved",
      target: getTargetProfile(config.defaultTarget),
      selectionSource: "project_default",
      message: `Using project fallback target ${config.defaultTarget}.`,
      capabilities: runtimeAdapterCapabilities,
    };
  }
  return {
    status: "needs_input",
    message: "No supported agent runtime was detected. Run this from a supported adapter or use --for <target>.",
    capabilities: runtimeAdapterCapabilities,
  };
}

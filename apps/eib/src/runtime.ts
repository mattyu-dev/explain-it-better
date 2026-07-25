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
  readonly detectionSource: "native_environment" | "adapter_environment" | "profile_default";
}

export interface RuntimeAdapterCapability {
  readonly adapterId: RuntimeAdapterId;
  readonly nativeProjectAsset: "skill" | "slash_command" | "none";
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
    detects: ["CODEX_THREAD_ID", "__CFBundleIdentifier=com.openai.codex"],
    providers: ["openai"],
  },
  {
    adapterId: "claude-code",
    nativeProjectAsset: "slash_command",
    detects: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
    providers: ["anthropic"],
  },
  {
    adapterId: "generic-cli",
    nativeProjectAsset: "none",
    detects: ["EIB_RUNTIME_PROVIDER", "EIB_RUNTIME_MODEL", "EIB_RUNTIME_SURFACE"],
    providers: [...new Set(targetProfiles.map((profile) => profile.provider))],
  },
];

/** Explicitly distinguish native host integrations from CLI/export-only targets. */
export function runtimeTargetCapabilities(): RuntimeTargetCapability[] {
  return targetProfiles.map((profile) => ({
    targetId: profile.id,
    provider: profile.provider,
    integration:
      profile.id === "openai-gpt-5.6-codex"
        ? "native_skill"
        : profile.id === "anthropic-claude-code-sonnet-5"
          ? "native_slash_command"
          : profile.availability === "target_only"
            ? "export_only"
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

function runtimeFromAdapterEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeDescriptor | undefined {
  const provider = nonEmpty(environment.EIB_RUNTIME_PROVIDER);
  const model = nonEmpty(environment.EIB_RUNTIME_MODEL);
  const surface = nonEmpty(environment.EIB_RUNTIME_SURFACE);
  const reasoningMode = nonEmpty(environment.EIB_RUNTIME_REASONING);
  if (provider === undefined || model === undefined || surface === undefined) return undefined;
  return {
    adapterId: "generic-cli",
    provider,
    model,
    surface,
    ...(reasoningMode === undefined
      ? {}
      : { reasoningMode }),
    tools: commaList(environment.EIB_RUNTIME_TOOLS),
    permissions: commaList(environment.EIB_RUNTIME_PERMISSIONS),
    detectionSource: "adapter_environment",
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
    return {
      adapterId: "codex",
      provider: "openai",
      model: nonEmpty(environment.CODEX_MODEL) ?? "gpt-5.6",
      surface: "coding_cli",
      ...(reasoningMode === undefined
        ? {}
        : { reasoningMode }),
      tools: ["filesystem", "terminal"],
      permissions: commaList(environment.CODEX_PERMISSION_PROFILE),
      detectionSource: nonEmpty(environment.CODEX_MODEL) === undefined
        ? "profile_default"
        : "native_environment",
    };
  }

  if (
    nonEmpty(environment.CLAUDECODE) !== undefined ||
    nonEmpty(environment.CLAUDE_CODE_ENTRYPOINT) !== undefined
  ) {
    const reasoningMode = nonEmpty(environment.CLAUDE_REASONING_MODE);
    return {
      adapterId: "claude-code",
      provider: "anthropic",
      model: nonEmpty(environment.CLAUDE_MODEL) ?? "claude-sonnet-5",
      surface: "coding_cli",
      ...(reasoningMode === undefined
        ? {}
        : { reasoningMode }),
      tools: ["filesystem", "terminal"],
      permissions: commaList(environment.CLAUDE_CODE_PERMISSIONS),
      detectionSource: nonEmpty(environment.CLAUDE_MODEL) === undefined
        ? "profile_default"
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
  if (exact.length === 1) return exact[0];
  const surfaceMatch = targetProfiles.filter(
    (profile) =>
      profile.provider.toLowerCase() === provider &&
      profile.surface.toLowerCase() === surface &&
      profile.availability === "active",
  );
  return surfaceMatch.length === 1 ? surfaceMatch[0] : undefined;
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
      message: `Detected ${runtime.adapterId}, but no reviewed target profile matches ${runtime.provider} ${runtime.model} on ${runtime.surface}. Use --for <target>.`,
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

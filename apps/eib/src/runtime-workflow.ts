import { createHash } from "node:crypto";
import {
  analyzeBrief,
  buildPromptSpec,
  createFastDraft,
  type PromptSpec,
  type RenderedTarget,
} from "@eib/core";
import {
  KNOWLEDGE_PACK_VERSION,
  type KnowledgeTargetProfile,
} from "@eib/knowledge";
import type { CliCommand } from "./args/types.js";
import { ExitCode as Codes } from "./args/types.js";
import { contextPromptEntries, discoverProjectContext, type ContextManifest } from "./project-context.js";
import {
  StaleRuntimeRunError,
  confirmRuntimeRun,
  createRuntimeRun,
  readRuntimeRun,
  type RuntimeRunFreshness,
} from "./runtime-store.js";
import {
  resolveRuntimeTarget,
  runtimeTargetCapabilities,
  type RuntimeResolution,
} from "./runtime.js";
import type { CliServiceResult } from "./service-contracts.js";

export interface RuntimeWorkflowOptions {
  readonly root: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The renderer stays owned by the CLI composition root; this workflow owns orchestration only. */
  readonly compilePrompt: (
    prompt: PromptSpec,
    targets: readonly string[],
    signal: AbortSignal,
  ) => RenderedTarget[];
}

function transformPreview(options: {
  readonly rawRequest: string;
  readonly target: KnowledgeTargetProfile;
  readonly resolution: RuntimeResolution;
  readonly context: ContextManifest;
  readonly assumptions: readonly string[];
  readonly handoff: string;
  readonly token: string;
}): string {
  const included = options.context.entries.filter((entry) => entry.included);
  const skipped = options.context.entries.filter((entry) => !entry.included);
  const runtime = options.resolution.runtime;
  return [
    "# EIB compiled task preview",
    "",
    `- Target: \`${options.target.id}\` (${options.target.provider} ${options.target.model}; ${options.target.surface})`,
    `- Target selection: ${options.resolution.selectionSource ?? "unresolved"}`,
    ...(runtime === undefined
      ? []
      : [`- Active runtime: ${runtime.adapterId}; reasoning ${runtime.reasoningMode ?? "surface-managed"}; tools ${runtime.tools.join(", ") || "none"}`]),
    `- Context mode: ${options.context.mode}; ${included.length} included, ${skipped.length} skipped`,
    `- Repository snapshot: ${options.context.repository.head ?? "not a Git worktree"}; ${options.context.repository.status}${options.context.repository.status === "dirty" ? ` (${options.context.repository.changedEntries} changed entries)` : ""}`,
    "",
    "## Raw request",
    options.rawRequest,
    "",
    "## Visible assumptions",
    ...(options.assumptions.length === 0 ? ["- None"] : options.assumptions.map((item) => `- ${item}`)),
    "",
    "## Context manifest",
    ...(options.context.entries.length === 0
      ? ["- No eligible project files were found."]
      : options.context.entries.map(
          (entry) => `- ${entry.included ? "included" : "skipped"}: \`${entry.path}\` (${entry.reason}${entry.sha256 === undefined ? "" : `; ${entry.sha256}`})`,
        )),
    "",
    "## Confirmation",
    `Review the brief below. To hand it to the active agent, run \`eib confirm ${options.token}\`.`,
    "",
    "## Compiled agent brief",
    options.handoff,
    "",
  ].join("\n");
}

function handoffBrief(options: {
  readonly artifact: RenderedTarget;
  readonly context: ContextManifest;
}): string {
  const included = options.context.entries.filter((entry) => entry.included);
  return [
    "# EIB execution contract",
    "",
    "Use the compiled target-specific brief below as the active task.",
    "Inspect the listed project context before making implementation decisions.",
    "Do not make destructive, external, costly, or scope-expanding changes without the user's confirmation.",
    `Repository snapshot at compilation: ${options.context.repository.head ?? "not a Git worktree"}; ${options.context.repository.status}. Re-run EIB if this context is no longer current.`,
    "",
    "## Selected project context",
    ...(included.length === 0
      ? ["- No eligible project context was selected."]
      : included.map((entry) => `- \`${entry.path}\` (${entry.reason}; sha256 ${entry.sha256})`)),
    "",
    "## Target-specific brief",
    options.artifact.content.trim(),
    "",
  ].join("\n");
}

function runtimeFreshness(
  context: ContextManifest,
  targetId: string,
): Omit<RuntimeRunFreshness, "expiresAt"> {
  const contextFingerprint = createHash("sha256").update(JSON.stringify({
    mode: context.mode,
    root: context.root,
    repository: context.repository,
    entries: context.entries.map(({ path, included, reason, sha256, bytes }) => ({ path, included, reason, sha256, bytes })),
  })).digest("hex");
  const knowledgeFingerprint = createHash("sha256")
    .update(`${KNOWLEDGE_PACK_VERSION}:${targetId}`, "utf8")
    .digest("hex");
  return { workspaceHead: context.repository.head, contextFingerprint, knowledgeFingerprint };
}

export async function executeRuntimeTransform(
  command: Extract<CliCommand, { name: "transform" }>,
  signal: AbortSignal,
  options: RuntimeWorkflowOptions,
): Promise<CliServiceResult> {
  if (command.brief === undefined || !command.brief.trim()) {
    return {
      status: "needs_input",
      message: "Describe what you want the active agent to achieve.",
      data: { field: "brief", question: "What should EIB transform into an agent brief?" },
      exitCode: Codes.needsInput,
    };
  }
  const original = analyzeBrief(command.brief);
  const blocking = original.unresolvedAmbiguity.find((item) => item.impact === "blocking");
  if (blocking !== undefined) {
    return { status: "needs_input", message: blocking.question, data: { intent: original, question: blocking }, exitCode: Codes.needsInput };
  }
  const resolution = await resolveRuntimeTarget({
    root: options.root,
    ...(command.explicitTarget === undefined ? {} : { explicitTarget: command.explicitTarget }),
    environment: options.environment,
  });
  if (resolution.status === "needs_input" || resolution.target === undefined) {
    return { status: "needs_input", message: resolution.message, data: { resolution }, exitCode: Codes.needsInput };
  }
  const context = await discoverProjectContext({ root: options.root, brief: command.brief, deep: command.deep, signal });
  const intent = createFastDraft(original);
  if (resolution.runtime !== undefined) {
    intent.preferences = [
      ...intent.preferences,
      `Active runtime: ${resolution.runtime.adapterId}; reasoning mode: ${resolution.runtime.reasoningMode ?? "surface-managed"}; tools: ${resolution.runtime.tools.join(", ") || "none"}; permissions: ${resolution.runtime.permissions.join(", ") || "unspecified"}.`,
    ];
  }
  intent.context = [...intent.context, ...contextPromptEntries(context)];
  const prompt = buildPromptSpec(intent);
  const artifact = options.compilePrompt(prompt, [resolution.target.id], signal)[0];
  if (artifact === undefined) throw new Error("Runtime target renderer produced no artifact.");
  const handoff = handoffBrief({ artifact, context });
  const run = await createRuntimeRun({
    root: options.root,
    rawRequest: command.brief,
    targetId: resolution.target.id,
    ...(resolution.runtime === undefined ? {} : { runtime: resolution.runtime }),
    context,
    assumptions: intent.assumptions,
    handoff,
    freshness: runtimeFreshness(context, resolution.target.id),
  });
  return {
    status: "ok",
    message: `Compiled a ${command.deep ? "deep" : "scoped"} runtime brief for ${resolution.target.id}. Confirmation required.`,
    data: {
      runToken: run.token,
      target: resolution.target,
      runtime: resolution.runtime,
      targetSelection: resolution.selectionSource,
      context,
      assumptions: intent.assumptions,
      handoff,
      capabilities: resolution.capabilities,
      targetCapabilities: runtimeTargetCapabilities(),
    },
    display: transformPreview({ rawRequest: command.brief, target: resolution.target, resolution, context, assumptions: intent.assumptions, handoff, token: run.token }),
    exitCode: Codes.success,
  };
}

export async function executeRuntimeConfirmation(
  command: Extract<CliCommand, { name: "confirm" }>,
  signal: AbortSignal,
  root: string,
): Promise<CliServiceResult> {
  const existing = await readRuntimeRun(root, command.token);
  const currentContext = await discoverProjectContext({ root, brief: existing.rawRequest, deep: existing.context.mode === "deep", signal });
  try {
    const run = await confirmRuntimeRun(root, command.token, runtimeFreshness(currentContext, existing.targetId));
    return {
      status: "ok",
      message: `Confirmed runtime brief ${run.token}.`,
      data: { runToken: run.token, confirmedAt: run.confirmedAt, handoff: run.handoff },
      display: ["# EIB confirmed handoff", "", `Run token \`${run.token}\` is confirmed. Follow this brief as the active task:`, "", run.handoff, ""].join("\n"),
      exitCode: Codes.success,
    };
  } catch (error) {
    if (error instanceof StaleRuntimeRunError) {
      return {
        status: "needs_input",
        message: error.message,
        data: { runToken: command.token, staleReasons: error.reasons, retransformRequired: true },
        exitCode: Codes.needsInput,
      };
    }
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ContextManifest } from "./project-context.js";
import type { RuntimeDescriptor } from "./runtime.js";

export const RUNTIME_RUN_TTL_MS = 30 * 60 * 1000;

const RuntimeRunFreshnessSchema = z.object({
  workspaceHead: z.string().nullable(),
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/iu),
  knowledgeFingerprint: z.string().regex(/^[a-f0-9]{64}$/iu),
  expiresAt: z.iso.datetime(),
}).strict();

const RuntimeRunSchema = z.object({
  version: z.literal(2),
  token: z.string().uuid(),
  createdAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().optional(),
  rawRequest: z.string().min(1),
  targetId: z.string().min(1),
  runtime: z.object({
    adapterId: z.string(),
    provider: z.string(),
    model: z.string(),
    surface: z.string(),
    reasoningMode: z.string().optional(),
    tools: z.array(z.string()),
    permissions: z.array(z.string()),
    detectionSource: z.string(),
  }).optional(),
  context: z.object({
    mode: z.enum(["scoped", "deep"]),
    root: z.string(),
    repository: z.object({
      head: z.string().nullable(),
      status: z.enum(["clean", "dirty", "unavailable"]),
      changedEntries: z.number().int().nonnegative(),
    }),
    entries: z.array(z.object({
      path: z.string(),
      included: z.boolean(),
      reason: z.string(),
      sha256: z.string().optional(),
      bytes: z.number().optional(),
      inlineContent: z.string().optional(),
      excerptContent: z.string().optional(),
      contentTruncated: z.boolean().optional(),
    })),
  }),
  freshness: RuntimeRunFreshnessSchema,
  assumptions: z.array(z.string()),
  handoff: z.string().min(1),
}).strict();

export type RuntimeRun = z.infer<typeof RuntimeRunSchema>;
export type RuntimeRunFreshness = z.infer<typeof RuntimeRunFreshnessSchema>;

export class StaleRuntimeRunError extends Error {
  public constructor(readonly reasons: readonly string[]) {
    super(`This EIB run is stale (${reasons.join(", ")}). Re-run eib transform to create a fresh brief.`);
    this.name = "StaleRuntimeRunError";
  }
}

function runDirectory(root: string): string {
  return join(resolve(root), ".eib", "runtime-runs");
}

function runPath(root: string, token: string): string {
  if (!/^[a-f0-9-]{36}$/iu.test(token)) throw new Error("Invalid runtime run token.");
  return join(runDirectory(root), `${token}.json`);
}

export async function readRuntimeRun(root: string, token: string): Promise<RuntimeRun> {
  return RuntimeRunSchema.parse(JSON.parse(await readFile(runPath(root, token), "utf8")) as unknown);
}

export async function createRuntimeRun(options: {
  readonly root: string;
  readonly rawRequest: string;
  readonly targetId: string;
  readonly runtime?: RuntimeDescriptor;
  readonly context: ContextManifest;
  readonly assumptions: readonly string[];
  readonly handoff: string;
  readonly freshness: Omit<RuntimeRunFreshness, "expiresAt">;
  /** Injectable only for deterministic tests. */
  readonly now?: Date;
}): Promise<RuntimeRun> {
  const createdAt = options.now ?? new Date();
  const run: RuntimeRun = RuntimeRunSchema.parse({
    version: 2,
    token: randomUUID(),
    createdAt: createdAt.toISOString(),
    rawRequest: options.rawRequest,
    targetId: options.targetId,
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    context: options.context,
    freshness: {
      ...options.freshness,
      expiresAt: new Date(createdAt.getTime() + RUNTIME_RUN_TTL_MS).toISOString(),
    },
    assumptions: [...options.assumptions],
    handoff: options.handoff,
  });
  const directory = runDirectory(options.root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = runPath(options.root, run.token);
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return run;
}

export async function confirmRuntimeRun(
  root: string,
  token: string,
  currentFreshness: Omit<RuntimeRunFreshness, "expiresAt">,
  now = new Date(),
): Promise<RuntimeRun> {
  const file = runPath(root, token);
  const run = await readRuntimeRun(root, token);
  const reasons = [
    ...(new Date(run.freshness.expiresAt).getTime() <= now.getTime() ? ["confirmation window expired"] : []),
    ...(run.freshness.workspaceHead !== currentFreshness.workspaceHead ? ["workspace HEAD changed"] : []),
    ...(run.freshness.contextFingerprint !== currentFreshness.contextFingerprint ? ["selected context changed"] : []),
    ...(run.freshness.knowledgeFingerprint !== currentFreshness.knowledgeFingerprint ? ["knowledge pack changed"] : []),
  ];
  if (reasons.length > 0) throw new StaleRuntimeRunError(reasons);
  if (run.confirmedAt !== undefined) return run;
  const confirmed = RuntimeRunSchema.parse({ ...run, confirmedAt: new Date().toISOString() });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(confirmed, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, file);
  return confirmed;
}

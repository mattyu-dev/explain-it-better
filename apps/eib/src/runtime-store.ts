import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ContextManifest } from "./project-context.js";
import type { RuntimeDescriptor } from "./runtime.js";

const RuntimeRunSchema = z.object({
  version: z.literal(1),
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
    entries: z.array(z.object({
      path: z.string(),
      included: z.boolean(),
      reason: z.string(),
      sha256: z.string().optional(),
      bytes: z.number().optional(),
      inlineContent: z.string().optional(),
    })),
  }),
  assumptions: z.array(z.string()),
  handoff: z.string().min(1),
}).strict();

export type RuntimeRun = z.infer<typeof RuntimeRunSchema>;

function runDirectory(root: string): string {
  return join(resolve(root), ".eib", "runtime-runs");
}

function runPath(root: string, token: string): string {
  if (!/^[a-f0-9-]{36}$/iu.test(token)) throw new Error("Invalid runtime run token.");
  return join(runDirectory(root), `${token}.json`);
}

export async function createRuntimeRun(options: {
  readonly root: string;
  readonly rawRequest: string;
  readonly targetId: string;
  readonly runtime?: RuntimeDescriptor;
  readonly context: ContextManifest;
  readonly assumptions: readonly string[];
  readonly handoff: string;
}): Promise<RuntimeRun> {
  const run: RuntimeRun = RuntimeRunSchema.parse({
    version: 1,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
    rawRequest: options.rawRequest,
    targetId: options.targetId,
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    context: options.context,
    assumptions: [...options.assumptions],
    handoff: options.handoff,
  });
  const directory = runDirectory(options.root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = runPath(options.root, run.token);
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return run;
}

export async function confirmRuntimeRun(root: string, token: string): Promise<RuntimeRun> {
  const file = runPath(root, token);
  const run = RuntimeRunSchema.parse(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (run.confirmedAt !== undefined) return run;
  const confirmed = RuntimeRunSchema.parse({ ...run, confirmedAt: new Date().toISOString() });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(confirmed, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, file);
  return confirmed;
}

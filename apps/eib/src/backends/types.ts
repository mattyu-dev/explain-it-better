import type { z } from "zod";

export type BackendId = "codex" | "claude" | "openai" | "hermes" | "kimi";
export type BackendRole = "compiler" | "target_only";

export type LocalBackendErrorCode =
  | "cancelled"
  | "not_found"
  | "output_invalid"
  | "output_too_large"
  | "process_failed"
  | "target_only"
  | "timed_out";

export class LocalBackendError extends Error {
  readonly code: LocalBackendErrorCode;
  readonly backend?: BackendId;
  readonly exitCode?: number;

  constructor(
    code: LocalBackendErrorCode,
    message: string,
    options: {
      backend?: BackendId;
      cause?: unknown;
      exitCode?: number;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LocalBackendError";
    this.code = code;
    if (options.backend !== undefined) {
      this.backend = options.backend;
    }
    if (options.exitCode !== undefined) {
      this.exitCode = options.exitCode;
    }
  }
}

export interface StructuredRunRequest<T> {
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StructuredRunResult<T> {
  backend: "codex" | "claude" | "openai";
  data: T;
  durationMs: number;
}

export interface LocalCompilerBackend {
  readonly id: "codex" | "claude" | "openai";
  readonly role: "compiler";
  readonly executable: string;
  runStructured<T>(request: StructuredRunRequest<T>): Promise<StructuredRunResult<T>>;
}

export interface BackendFactoryOptions {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

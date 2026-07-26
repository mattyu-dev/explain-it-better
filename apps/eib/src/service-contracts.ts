import type { ExitCode } from "./args/types.js";
import { ExitCode as Codes } from "./args/types.js";

/** Shared, transport-neutral result returned by a CLI command handler. */
export interface CliServiceResult {
  readonly status: "ok" | "needs_input";
  readonly message: string;
  readonly data: unknown;
  readonly exitCode: ExitCode;
  /** Readable preview for commands whose payload is too rich for one status line. */
  readonly display?: string;
}

/** Error boundary shared by command workflows and the CLI transport. */
export class CliServiceError extends Error {
  public readonly exitCode: ExitCode;
  public readonly details?: unknown;

  public constructor(message: string, exitCode: ExitCode = Codes.error, details?: unknown) {
    super(message);
    this.name = "CliServiceError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

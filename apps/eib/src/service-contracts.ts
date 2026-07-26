import type { ExitCode } from "./args/types.js";

/** Shared, transport-neutral result returned by a CLI command handler. */
export interface CliServiceResult {
  readonly status: "ok" | "needs_input";
  readonly message: string;
  readonly data: unknown;
  readonly exitCode: ExitCode;
  /** Readable preview for commands whose payload is too rich for one status line. */
  readonly display?: string;
}

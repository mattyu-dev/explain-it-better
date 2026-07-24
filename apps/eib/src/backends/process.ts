import { spawn } from "node:child_process";

import { LocalBackendError, type BackendId } from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TERMINATION_GRACE_MS = 500;

export interface ProcessRunOptions {
  backend: BackendId;
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number;
}

function describeCommand(executable: string): string {
  const pieces = executable.split(/[\\/]/u);
  return pieces.at(-1) ?? executable;
}

export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("Backend timeout must be a positive safe integer in milliseconds.");
  }
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("Backend output limit must be a positive safe integer in bytes.");
  }
  if (options.signal?.aborted === true) {
    throw new LocalBackendError("cancelled", `${options.backend} invocation was cancelled`, {
      backend: options.backend,
    });
  }

  const startedAt = performance.now();

  return await new Promise<ProcessRunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminationCode: "cancelled" | "output_too_large" | "timed_out" | undefined;
    let settled = false;

    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const terminate = (code: typeof terminationCode): void => {
      if (terminationCode !== undefined) {
        return;
      }
      terminationCode = code;
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, TERMINATION_GRACE_MS);
      forceTimer.unref();
    };

    const timeout = setTimeout(() => {
      terminate("timed_out");
    }, options.timeoutMs);
    timeout.unref();

    const abort = (): void => {
      terminate("cancelled");
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminate("output_too_large");
        return;
      }
      if (stream === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      append("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      append("stderr", chunk);
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      const notFound = error.code === "ENOENT";
      reject(
        new LocalBackendError(
          notFound ? "not_found" : "process_failed",
          notFound
            ? `${describeCommand(options.executable)} is not installed or not on PATH`
            : `Failed to start ${options.backend}: ${error.message}`,
          { backend: options.backend, cause: error },
        ),
      );
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);

      if (terminationCode !== undefined) {
        const messages = {
          cancelled: `${options.backend} invocation was cancelled`,
          output_too_large: `${options.backend} exceeded the ${maxOutputBytes} byte output limit`,
          timed_out: `${options.backend} timed out after ${options.timeoutMs}ms`,
        } as const;
        reject(
          new LocalBackendError(terminationCode, messages[terminationCode], {
            backend: options.backend,
          }),
        );
        return;
      }

      if (exitCode !== 0) {
        const diagnostic = stderr.trim().slice(0, 500);
        reject(
          new LocalBackendError(
            "process_failed",
            `${options.backend} exited with ${exitCode ?? signal ?? "an unknown status"}${
              diagnostic.length > 0 ? `: ${diagnostic}` : ""
            }`,
            {
              backend: options.backend,
              ...(exitCode === null ? {} : { exitCode }),
            },
          ),
        );
        return;
      }

      resolve({
        stdout,
        stderr,
        durationMs: performance.now() - startedAt,
        exitCode: 0,
      });
    });

    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        terminate("cancelled");
      }
    });
    child.stdin.end(options.input ?? "");
  });
}

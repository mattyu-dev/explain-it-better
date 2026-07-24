import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { runProcess } from "./process.js";
import { parseStructuredOutput } from "./structured-output.js";
import type {
  BackendFactoryOptions,
  LocalCompilerBackend,
  StructuredRunRequest,
  StructuredRunResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export function createClaudeBackend(
  options: BackendFactoryOptions = {},
): LocalCompilerBackend {
  const executable = options.executable ?? "claude";

  return {
    id: "claude",
    role: "compiler",
    executable,
    async runStructured<T>(
      request: StructuredRunRequest<T>,
    ): Promise<StructuredRunResult<T>> {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), "eib-claude-"));
      const jsonSchema = z.toJSONSchema(request.schema, { io: "output" });
      const args = [
        "--print",
        "--safe-mode",
        "--no-chrome",
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        "{}",
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(jsonSchema),
      ];
      if (request.model !== undefined) {
        args.push("--model", request.model);
      }

      try {
        const processResult = await runProcess({
          backend: "claude",
          executable,
          args,
          cwd: temporaryDirectory,
          input: request.prompt,
          timeoutMs: request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.maxOutputBytes === undefined
            ? {}
            : { maxOutputBytes: options.maxOutputBytes }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        return {
          backend: "claude",
          data: parseStructuredOutput(
            processResult.stdout,
            request.schema,
            "claude",
            { claudeEnvelope: true },
          ),
          durationMs: processResult.durationMs,
        };
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
  };
}

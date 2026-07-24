import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

export function createCodexBackend(
  options: BackendFactoryOptions = {},
): LocalCompilerBackend {
  const executable = options.executable ?? "codex";

  return {
    id: "codex",
    role: "compiler",
    executable,
    async runStructured<T>(
      request: StructuredRunRequest<T>,
    ): Promise<StructuredRunResult<T>> {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), "eib-codex-"));
      const schemaPath = join(temporaryDirectory, "output.schema.json");
      const outputPath = join(temporaryDirectory, "last-message.json");
      const jsonSchema = z.toJSONSchema(request.schema, { io: "output" });
      await writeFile(schemaPath, JSON.stringify(jsonSchema), {
        encoding: "utf8",
        mode: 0o600,
      });

      const args = [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--cd",
        temporaryDirectory,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--color",
        "never",
        "-c",
        'approval_policy="never"',
        "-c",
        'web_search="disabled"',
        "-c",
        "features.agents=false",
      ];
      if (request.model !== undefined) {
        args.push("--model", request.model);
      }
      args.push("-");

      try {
        const processResult = await runProcess({
          backend: "codex",
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
        const rawOutput = await readFile(outputPath, "utf8").catch(() => processResult.stdout);
        return {
          backend: "codex",
          data: parseStructuredOutput(rawOutput, request.schema, "codex"),
          durationMs: processResult.durationMs,
        };
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
  };
}

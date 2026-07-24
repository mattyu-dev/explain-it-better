import type { z } from "zod";

import { LocalBackendError, type BackendId } from "./types.js";

function removeMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function parseJson(value: string, backend: BackendId): unknown {
  try {
    return JSON.parse(removeMarkdownFence(value)) as unknown;
  } catch (error) {
    throw new LocalBackendError(
      "output_invalid",
      `${backend} returned output that was not valid JSON`,
      { backend, cause: error },
    );
  }
}

function unwrapClaudeOutput(value: unknown, backend: BackendId): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record["is_error"] === true) {
    throw new LocalBackendError(
      "process_failed",
      `${backend} reported an unsuccessful result`,
      { backend },
    );
  }
  if ("structured_output" in record) {
    return record["structured_output"];
  }
  if (typeof record["result"] === "string") {
    return parseJson(record["result"], backend);
  }
  return value;
}

export function parseStructuredOutput<T>(
  raw: string,
  schema: z.ZodType<T>,
  backend: BackendId,
  options: { claudeEnvelope?: boolean } = {},
): T {
  const parsed = parseJson(raw, backend);
  const candidate = options.claudeEnvelope === true
    ? unwrapClaudeOutput(parsed, backend)
    : parsed;
  const validation = schema.safeParse(candidate);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    const location = issue?.path.length === 0 ? "response" : issue?.path.join(".");
    throw new LocalBackendError(
      "output_invalid",
      `${backend} returned JSON that did not match the requested schema${
        issue === undefined ? "" : ` at ${location}: ${issue.message}`
      }`,
      { backend, cause: validation.error },
    );
  }
  return validation.data;
}

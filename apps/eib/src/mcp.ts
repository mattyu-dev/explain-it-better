#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCliServices, type CliServices } from "./services.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

interface McpToolResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly structuredContent: Record<string, unknown>;
  readonly isError: boolean;
}

export interface McpServerOptions {
  readonly root?: string;
  readonly servicesForRoot?: (root: string) => CliServices;
  readonly write?: (line: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(request: JsonRpcRequest): string | number | null {
  return request.id ?? null;
}

function response(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function error(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function stringParameter(params: Record<string, unknown>, name: string, required = false): string | undefined {
  const value = params[name];
  if (value === undefined) {
    if (required) throw new Error(`Missing required parameter ${JSON.stringify(name)}.`);
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Parameter ${JSON.stringify(name)} must be a non-empty string.`);
  }
  return value;
}

function booleanParameter(params: Record<string, unknown>, name: string): boolean {
  const value = params[name];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`Parameter ${JSON.stringify(name)} must be a boolean.`);
  return value;
}

function toolDefinitions(): Record<string, unknown> {
  return {
    tools: [
      {
        name: "eib_prepare",
        description: "Compile a request into an EIB target-aware preview. Show its target, selected context, and assumptions, then wait for explicit user confirmation before calling eib_confirm.",
        inputSchema: {
          type: "object",
          properties: {
            request: { type: "string", minLength: 1, description: "The user's request to compile." },
            workspaceRoot: { type: "string", description: "Absolute local workspace path. Defaults to the MCP server working directory." },
            target: { type: "string", description: "Reviewed EIB target id. Required when the host cannot expose its exact active model metadata." },
            deep: { type: "boolean", description: "Scan safe tracked repository text only when the user explicitly asks for a full scan." },
          },
          required: ["request"],
          additionalProperties: false,
        },
      },
      {
        name: "eib_confirm",
        description: "Confirm a previously prepared EIB brief after the user explicitly approves it. Returns the handoff instructions to follow as the active task.",
        inputSchema: {
          type: "object",
          properties: {
            runToken: { type: "string", minLength: 1, description: "Token returned by eib_prepare." },
            workspaceRoot: { type: "string", description: "The same workspace used for eib_prepare." },
          },
          required: ["runToken"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function toolResult(result: Awaited<ReturnType<CliServices["execute"]>>): McpToolResult {
  const structuredContent = {
    status: result.status,
    message: result.message,
    ...(result.data === undefined ? {} : { data: result.data }),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: result.exitCode !== 0,
  };
}

async function callTool(
  params: unknown,
  options: McpServerOptions,
): Promise<McpToolResult> {
  if (!isRecord(params) || typeof params.name !== "string" || !isRecord(params.arguments)) {
    throw new Error("tools/call requires a tool name and object arguments.");
  }
  const root = stringParameter(params.arguments, "workspaceRoot") ?? options.root ?? process.cwd();
  const services = (options.servicesForRoot ?? ((workspaceRoot) => createCliServices({ workspaceRoot })))(root);
  const signal = new AbortController().signal;
  switch (params.name) {
    case "eib_prepare": {
      const brief = stringParameter(params.arguments, "request", true)!;
      const target = stringParameter(params.arguments, "target");
      return toolResult(await services.execute({
        name: "transform",
        global: { json: true },
        brief,
        runtime: "auto",
        deep: booleanParameter(params.arguments, "deep"),
        ...(target === undefined ? {} : { explicitTarget: target }),
      }, signal));
    }
    case "eib_confirm":
      return toolResult(await services.execute({
        name: "confirm",
        global: { json: true },
        token: stringParameter(params.arguments, "runToken", true)!,
      }, signal));
    default:
      throw new Error(`Unknown EIB tool ${JSON.stringify(params.name)}.`);
  }
}

export async function handleMcpRequest(
  value: unknown,
  options: McpServerOptions = {},
): Promise<Record<string, unknown> | undefined> {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return error(null, -32600, "Invalid JSON-RPC request.");
  }
  const request = value as unknown as JsonRpcRequest;
  if (request.id !== undefined && typeof request.id !== "string" && typeof request.id !== "number" && request.id !== null) {
    return error(null, -32600, "JSON-RPC request id must be a string, number, or null.");
  }
  const id = requestId(request);
  try {
    switch (request.method) {
      case "initialize":
        return response(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "explain-it-better", version: "0.2.1" },
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "tools/list":
        return response(id, toolDefinitions());
      case "tools/call":
        return response(id, await callTool(request.params, options));
      default:
        return error(id, -32601, `Method ${JSON.stringify(request.method)} is not supported.`);
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return error(id, -32602, message);
  }
}

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      write(JSON.stringify(error(null, -32700, "Invalid JSON.")));
      continue;
    }
    const result = await handleMcpRequest(parsed, options);
    if (result !== undefined) write(JSON.stringify(result));
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(realpathSync(resolve(invokedPath))).href === import.meta.url
) {
  void runMcpServer().catch((caught: unknown) => {
    process.stderr.write(`${caught instanceof Error ? caught.message : String(caught)}\n`);
    process.exitCode = 1;
  });
}

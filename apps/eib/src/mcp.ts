#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EIB_VERSION } from "./args/types.js";
import { createCliServices, type CliServices } from "./services.js";

/** New clients negotiate the current protocol; retain the previous version for installed hosts. */
const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const MAX_TOOL_TIMEOUT_MS = 300_000;

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
  /**
   * Bound a single tool request so a stalled backend cannot block the stdio
   * connection indefinitely. Values are capped to retain this guarantee.
   */
  readonly toolTimeoutMs?: number;
}

export interface McpSession {
  handle(value: unknown): Promise<Record<string, unknown> | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(request: JsonRpcRequest): string | number | null {
  return request.id ?? null;
}

function isRequestId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
}

function response(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function error(
  id: string | number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

class McpRequestError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "McpRequestError";
  }
}

function toolTimeoutMs(options: McpServerOptions): number {
  const configured = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  if (!Number.isFinite(configured)) return DEFAULT_TOOL_TIMEOUT_MS;
  return Math.min(Math.max(1, Math.floor(configured)), MAX_TOOL_TIMEOUT_MS);
}

/**
 * Give backend work a cancellable signal and a hard response deadline. The
 * race is deliberate: adapters are expected to honor AbortSignal, but a
 * faulty adapter must not prevent the stdio server from processing later
 * requests or cancellation notifications.
 */
async function runBoundedTool<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let rejectControl: ((reason: McpRequestError) => void) | undefined;
  const rejectWithCancellation = (): void => {
    const cancellation = new McpRequestError(-32800, "MCP request was cancelled.");
    controller.abort(cancellation);
    rejectControl?.(cancellation);
  };
  const control = new Promise<never>((_resolve, reject) => {
    rejectControl = reject;
  });
  const onParentAbort = (): void => rejectWithCancellation();
  if (parentSignal.aborted) {
    rejectWithCancellation();
  } else {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    const timedOut = new McpRequestError(-32000, `MCP tool call timed out after ${timeoutMs}ms.`);
    controller.abort(timedOut);
    rejectControl?.(timedOut);
  }, timeoutMs);
  timer.unref();
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), control]);
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
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

function onlyKnownParameters(params: Record<string, unknown>, names: readonly string[]): void {
  const unknown = Object.keys(params).filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unsupported tool parameter(s): ${unknown.map((name) => JSON.stringify(name)).join(", ")}.`);
  }
}

function initializeResult(params: unknown): Record<string, unknown> {
  if (!isRecord(params) || typeof params.protocolVersion !== "string") {
    throw new Error("initialize requires a string protocolVersion.");
  }
  if (!MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion as typeof MCP_PROTOCOL_VERSIONS[number])) {
    throw new Error(`Unsupported MCP protocol version ${JSON.stringify(params.protocolVersion)}.`);
  }
  return {
    protocolVersion: params.protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "explain-it-better", version: EIB_VERSION },
  };
}

function toolDefinitions(): Record<string, unknown> {
  return {
    tools: [
      {
        name: "eib_prepare",
        description: "Compile a request into an EIB target-aware preview for this server's configured workspace. Show its target, selected context metadata, and assumptions, then wait for explicit user confirmation before calling eib_confirm.",
        inputSchema: {
          type: "object",
          properties: {
            request: { type: "string", minLength: 1, description: "The user's request to compile." },
            target: { type: "string", description: "Reviewed EIB target id. Required when the host cannot expose its exact active model metadata." },
            deep: { type: "boolean", description: "Scan safe tracked repository text only when the user explicitly asks for a full scan." },
          },
          required: ["request"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { status: { type: "string" }, message: { type: "string" }, data: {} },
          required: ["status", "message"],
          additionalProperties: false,
        },
      },
      {
        name: "eib_confirm",
        description: "Record acknowledgement of a previously prepared EIB brief. The host must call this only after explicit user approval; it returns the handoff instructions and does not itself execute the task.",
        inputSchema: {
          type: "object",
          properties: {
            runToken: { type: "string", minLength: 1, description: "Token returned by eib_prepare." },
          },
          required: ["runToken"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { status: { type: "string" }, message: { type: "string" }, data: {} },
          required: ["status", "message"],
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
  signal: AbortSignal,
): Promise<McpToolResult> {
  if (!isRecord(params) || typeof params.name !== "string" || !isRecord(params.arguments)) {
    throw new Error("tools/call requires a tool name and object arguments.");
  }
  const toolArguments = params.arguments;
  if (Object.hasOwn(toolArguments, "workspaceRoot")) {
    throw new Error("workspaceRoot is not accepted by MCP; launch the server with its approved workspace root.");
  }
  const root = realpathSync(resolve(options.root ?? process.cwd()));
  const services = (options.servicesForRoot ?? ((workspaceRoot) => createCliServices({ workspaceRoot })))(root);
  switch (params.name) {
    case "eib_prepare": {
      onlyKnownParameters(toolArguments, ["request", "target", "deep"]);
      const brief = stringParameter(toolArguments, "request", true)!;
      const target = stringParameter(toolArguments, "target");
      return toolResult(await runBoundedTool((toolSignal) => services.execute({
        name: "transform",
        global: { json: true },
        brief,
        runtime: "auto",
        deep: booleanParameter(toolArguments, "deep"),
        ...(target === undefined ? {} : { explicitTarget: target }),
      }, toolSignal), signal, toolTimeoutMs(options)));
    }
    case "eib_confirm":
      onlyKnownParameters(toolArguments, ["runToken"]);
      return toolResult(await runBoundedTool((toolSignal) => services.execute({
        name: "confirm",
        global: { json: true },
        token: stringParameter(toolArguments, "runToken", true)!,
      }, toolSignal), signal, toolTimeoutMs(options)));
    default:
      throw new Error(`Unknown EIB tool ${JSON.stringify(params.name)}.`);
  }
}

export async function handleMcpRequest(
  value: unknown,
  options: McpServerOptions = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<Record<string, unknown> | undefined> {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return error(null, -32600, "Invalid JSON-RPC request.");
  }
  const request = value as unknown as JsonRpcRequest;
  if (request.id !== undefined && typeof request.id !== "string" && typeof request.id !== "number" && request.id !== null) {
    return error(null, -32600, "JSON-RPC request id must be a string, number, or null.");
  }
  const id = requestId(request);
  const notification = request.id === undefined;
  const reply = (result: Record<string, unknown>): Record<string, unknown> | undefined => notification ? undefined : result;
  try {
    switch (request.method) {
      case "initialize":
        return reply(response(id, initializeResult(request.params)));
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "tools/list":
        return reply(response(id, toolDefinitions()));
      case "tools/call":
        return reply(response(id, await callTool(request.params, options, signal)));
      default:
        return reply(error(id, -32601, `Method ${JSON.stringify(request.method)} is not supported.`));
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return reply(error(id, caught instanceof McpRequestError ? caught.code : -32602, message));
  }
}

/**
 * Stateful lifecycle gate for a single stdio connection. Use this in servers;
 * `handleMcpRequest` remains a one-request helper for embedders and unit tests.
 */
export function createMcpSession(options: McpServerOptions = {}): McpSession {
  let initialized = false;
  const inFlight = new Map<string | number | null, AbortController>();
  return {
    async handle(value: unknown): Promise<Record<string, unknown> | undefined> {
      if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
        return error(null, -32600, "Invalid JSON-RPC request.");
      }
      const request = value as unknown as JsonRpcRequest;
      const id = requestId(request);
      const notification = request.id === undefined;
      const reply = (result: Record<string, unknown>): Record<string, unknown> | undefined => notification ? undefined : result;
      if (request.method === "initialize") {
        if (initialized) return reply(error(id, -32600, "MCP session is already initialized."));
        try {
          const result = initializeResult(request.params);
          initialized = true;
          return reply(response(id, result));
        } catch (caught) {
          return reply(error(id, -32602, caught instanceof Error ? caught.message : String(caught)));
        }
      }
      if (request.method === "notifications/cancelled") {
        const cancellationId = isRecord(request.params) ? request.params.requestId : undefined;
        if (isRequestId(cancellationId)) inFlight.get(cancellationId)?.abort();
        return undefined;
      }
      if (!initialized) {
        return reply(error(id, -32002, "Initialize the MCP session before calling tools."));
      }
      if (request.method !== "tools/call" || notification || !isRequestId(request.id)) {
        return handleMcpRequest(request, options);
      }
      if (inFlight.has(request.id)) {
        return reply(error(request.id, -32600, "Duplicate JSON-RPC request id is already in flight."));
      }
      const controller = new AbortController();
      inFlight.set(request.id, controller);
      try {
        return await handleMcpRequest(request, options, controller.signal);
      } finally {
        if (inFlight.get(request.id) === controller) inFlight.delete(request.id);
      }
    },
  };
}

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const session = createMcpSession(options);
  for await (const line of input) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      write(JSON.stringify(error(null, -32700, "Invalid JSON.")));
      continue;
    }
    // Do not await tools: a client must be able to send a cancellation while
    // an earlier backend call is still running. JSON-RPC permits responses to
    // arrive out of order for concurrently processed requests.
    void session.handle(parsed).then((result) => {
      if (result !== undefined) write(JSON.stringify(result));
    }).catch((caught: unknown) => {
      write(JSON.stringify(error(null, -32603, caught instanceof Error ? caught.message : String(caught))));
    });
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

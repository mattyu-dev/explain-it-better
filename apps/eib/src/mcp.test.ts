import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMcpSession, handleMcpRequest } from "./mcp.js";
import type { CliServices } from "./services.js";

function controlledServices(execute: CliServices["execute"]): CliServices {
  return { execute, listTargets: () => [] };
}

describe("EIB MCP server", () => {
  it("advertises and executes the confirmation-gated EIB workflow", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-mcp-"));
    await writeFile(join(root, "AGENTS.md"), "Run validation before editing.\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"mcp-fixture"}\n', "utf8");
    try {
      const session = createMcpSession({ root });
      await expect(session.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      })).resolves.toMatchObject({ result: { protocolVersion: "2025-11-25" } });
      const listed = await session.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      expect(listed).toMatchObject({ result: { tools: [{ name: "eib_prepare" }, { name: "eib_confirm" }] } });

      const prepared = await session.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "eib_prepare",
          arguments: {
            request: "Review this project architecture and produce a prioritized improvement plan.",
            target: "openai-gpt-5.6-codex",
          },
        },
      });
      expect(prepared).toMatchObject({ result: { isError: false } });
      const preparedResult = prepared?.result as { structuredContent: { data: { runToken: string; context: { entries: unknown[] } } } };
      expect(preparedResult.structuredContent.data.context.entries).not.toHaveLength(0);

      const confirmed = await session.handle({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "eib_confirm",
          arguments: { runToken: preparedResult.structuredContent.data.runToken },
        },
      });
      const confirmedResult = confirmed?.result as {
        isError: boolean;
        structuredContent: { data: { handoff: string } };
      };
      expect(confirmedResult.isError).toBe(false);
      expect(confirmedResult.structuredContent.data.handoff).toContain("EIB execution contract");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps malformed or unsupported requests fail-closed", async () => {
    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "eib_prepare", arguments: {} } })).resolves.toMatchObject({
      error: { code: -32602 },
    });
    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "resources/list" })).resolves.toMatchObject({
      error: { code: -32601 },
    });
    const unexpectedParameter = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "eib_prepare", arguments: { request: "Review this project.", unexpected: true } },
    });
    expect(JSON.stringify(unexpectedParameter)).toContain("Unsupported tool parameter");
  });

  it("negotiates only supported protocol versions and rejects tool calls before initialization", async () => {
    const session = createMcpSession();
    await expect(session.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })).resolves.toMatchObject({
      error: { code: -32002 },
    });
    const unsupportedVersion = await session.handle({
      jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" },
    });
    expect(JSON.stringify(unsupportedVersion)).toContain("Unsupported MCP protocol");
    await expect(session.handle({
      jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" },
    })).resolves.toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("binds every MCP call to the launch workspace and suppresses notifications", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-mcp-bound-"));
    const outside = await mkdtemp(join(await realpath(tmpdir()), "eib-mcp-outside-"));
    try {
      const rejected = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "eib_prepare", arguments: { request: "Review this project.", workspaceRoot: outside } },
      }, { root });
      expect(JSON.stringify(rejected)).toContain("workspaceRoot is not accepted");
      await expect(handleMcpRequest({ jsonrpc: "2.0", method: "tools/list" }, { root })).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("cancels an in-flight tool request without blocking later stdio messages", async () => {
    let toolSignal: AbortSignal | undefined;
    const session = createMcpSession({
      servicesForRoot: () => controlledServices(async (_command, signal) => {
        toolSignal = signal;
        return await new Promise(() => undefined);
      }),
    });
    await session.handle({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" },
    });
    const pending = session.handle({
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: { name: "eib_prepare", arguments: { request: "Review this project." } },
    });
    await vi.waitFor(() => expect(toolSignal).toBeDefined());

    await expect(session.handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 44, reason: "User cancelled" },
    })).resolves.toBeUndefined();
    await expect(pending).resolves.toMatchObject({ error: { code: -32800, message: "MCP request was cancelled." } });
    expect(toolSignal?.aborted).toBe(true);
    const listed = await session.handle({ jsonrpc: "2.0", id: 45, method: "tools/list" });
    expect(JSON.stringify(listed)).toContain("eib_prepare");
  });

  it("rejects a duplicate active request id so cancellation cannot strand a tool", async () => {
    let executions = 0;
    let toolSignal: AbortSignal | undefined;
    const session = createMcpSession({
      servicesForRoot: () => controlledServices(async (_command, signal) => {
        executions += 1;
        toolSignal = signal;
        return await new Promise(() => undefined);
      }),
    });
    await session.handle({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" },
    });
    const first = session.handle({
      jsonrpc: "2.0",
      id: 46,
      method: "tools/call",
      params: { name: "eib_prepare", arguments: { request: "Review this project." } },
    });
    await vi.waitFor(() => expect(toolSignal).toBeDefined());
    await expect(session.handle({
      jsonrpc: "2.0",
      id: 46,
      method: "tools/call",
      params: { name: "eib_prepare", arguments: { request: "Review this project again." } },
    })).resolves.toMatchObject({ error: { code: -32600, message: "Duplicate JSON-RPC request id is already in flight." } });
    expect(executions).toBe(1);

    await session.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 46 } });
    await expect(first).resolves.toMatchObject({ error: { code: -32800 } });
    expect(toolSignal?.aborted).toBe(true);
  });

  it("returns a bounded server error when a tool adapter does not honor cancellation", async () => {
    const session = createMcpSession({
      toolTimeoutMs: 10,
      servicesForRoot: () => controlledServices(async () => await new Promise(() => undefined)),
    });
    await session.handle({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" },
    });
    await expect(session.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "eib_prepare", arguments: { request: "Review this project." } },
    })).resolves.toMatchObject({ error: { code: -32000, message: "MCP tool call timed out after 10ms." } });
  });
});

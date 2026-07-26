import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "./mcp.js";

describe("EIB MCP server", () => {
  it("advertises and executes the confirmation-gated EIB workflow", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "eib-mcp-"));
    await writeFile(join(root, "AGENTS.md"), "Run validation before editing.\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"mcp-fixture"}\n', "utf8");
    try {
      const listed = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(listed).toMatchObject({ result: { tools: [{ name: "eib_prepare" }, { name: "eib_confirm" }] } });

      const prepared = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "eib_prepare",
          arguments: {
            request: "Review this project architecture and produce a prioritized improvement plan.",
            target: "openai-gpt-5.6-codex",
          },
        },
      }, { root });
      expect(prepared).toMatchObject({ result: { isError: false } });
      const preparedResult = prepared?.result as { structuredContent: { data: { runToken: string; context: { entries: unknown[] } } } };
      expect(preparedResult.structuredContent.data.context.entries).not.toHaveLength(0);

      const confirmed = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "eib_confirm",
          arguments: { runToken: preparedResult.structuredContent.data.runToken },
        },
      }, { root });
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
});

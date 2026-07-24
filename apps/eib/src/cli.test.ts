import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const tuiRenderState = vi.hoisted(() => ({ cancel: false }));

vi.mock("ink", () => ({
  render(element: { props: { onCancel: () => void } }) {
    if (tuiRenderState.cancel) {
      element.props.onCancel();
    }
    return { waitUntilExit: () => Promise.resolve() };
  },
}));

import { runCli, type CliIo } from "./cli.js";
import { ExitCode } from "./args/types.js";
import type { CliServices } from "./services.js";

function capture(): {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
} {
  let out = "";
  let error = "";
  return {
    io: {
      stdout: {
        isTTY: false,
        write(value: string | Uint8Array) {
          out += String(value);
          return true;
        },
      },
      stderr: {
        write(value: string | Uint8Array) {
          error += String(value);
          return true;
        },
      },
    },
    stdout: () => out,
    stderr: () => error,
  };
}

const services: CliServices = {
  listTargets: () => [],
  execute(command) {
    return Promise.resolve({
      status: "ok",
      message: `${command.name} complete`,
      data: { command: command.name },
      exitCode: ExitCode.success,
    });
  },
};

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("runCli", () => {
  it("emits one JSON document for machine-readable commands", async () => {
    const output = capture();
    const exitCode = await runCli(["doctor", "--json"], output.io, services);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({
      ok: true,
      command: "doctor",
      data: { command: "doctor" },
    });
    expect(output.stderr()).toBe("");
  });

  it("uses a deterministic usage exit code and JSON error shape", async () => {
    const output = capture();
    const exitCode = await runCli(["compile", "--json"], output.io, services);
    expect(exitCode).toBe(ExitCode.usage);
    expect(JSON.parse(output.stderr())).toMatchObject({
      ok: false,
      error: { code: "USAGE" },
    });
    expect(output.stdout()).toBe("");
  });

  it("refuses the TUI when standard streams are not terminals", async () => {
    const output = capture();
    const exitCode = await runCli([], output.io, services);
    expect(exitCode).toBe(ExitCode.usage);
    expect(output.stderr()).toContain("requires a terminal");
  });

  it("returns the cancellation exit code when Ink handles Ctrl+C", async () => {
    const output = capture();
    Object.defineProperty(output.io.stdout, "isTTY", { value: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    tuiRenderState.cancel = true;
    try {
      await expect(runCli([], output.io, services)).resolves.toBe(ExitCode.cancelled);
    } finally {
      tuiRenderState.cancel = false;
      if (stdinDescriptor === undefined) {
        Reflect.deleteProperty(process.stdin, "isTTY");
      } else {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      }
    }
  });

  it("keeps a normally exited TUI successful", async () => {
    const output = capture();
    Object.defineProperty(output.io.stdout, "isTTY", { value: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await expect(runCli([], output.io, services)).resolves.toBe(ExitCode.success);
    } finally {
      if (stdinDescriptor === undefined) {
        Reflect.deleteProperty(process.stdin, "isTTY");
      } else {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      }
    }
  });

  it("passes a static fixture file through to eval services", async () => {
    const output = capture();
    const fixtureServices: CliServices = {
      listTargets: () => [],
      execute(command) {
        expect(command).toMatchObject({
          name: "eval",
          mode: "static",
          fixtures: "outputs.json",
        });
        return Promise.resolve({
          status: "ok",
          message: "Static validation passed.",
          data: {},
          exitCode: ExitCode.success,
        });
      },
    };

    await expect(
      runCli(["eval", "package", "--fixtures", "outputs.json", "--json"], output.io, fixtureServices),
    ).resolves.toBe(ExitCode.success);
  });

  it("keeps candidate-promotion evidence machine-readable", async () => {
    const output = capture();
    const optimizeServices: CliServices = {
      listTargets: () => [],
      execute(command) {
        expect(command).toMatchObject({
          name: "optimize",
          packagePath: "package",
          runs: "runs.json",
          maxCandidates: 3,
        });
        return Promise.resolve({
          status: "ok",
          message: "Candidate promotion gate completed.",
          data: { report: { promoted: false, selectedCandidateId: "baseline" } },
          exitCode: ExitCode.success,
        });
      },
    };

    await expect(
      runCli(["optimize", "package", "--runs", "runs.json", "--json"], output.io, optimizeServices),
    ).resolves.toBe(ExitCode.success);
    expect(JSON.parse(output.stdout())).toMatchObject({
      ok: true,
      command: "optimize",
      data: { report: { promoted: false } },
    });
    expect(output.stderr()).toBe("");
  });

  it("renders the exact install plan during a non-JSON dry run", async () => {
    const output = capture();
    const content = "new instruction\n";
    const target = "/project/.codex";
    const dryRunServices: CliServices = {
      listTargets: () => [],
      execute() {
        return Promise.resolve({
          status: "ok",
          message: "Dry-run complete. Review the actions; rerun with --apply to write them.",
          data: {
            applied: false,
            plan: {
              version: 1,
              packageId: "review-me",
              target,
              manifestPath: `${target}/.eib-install-manifest.json`,
              manifestHash: null,
              backupDirectory: `${target}/.eib-backups/review`,
              actions: [
                {
                  kind: "create",
                  relativePath: "AGENTS.md",
                  destination: `${target}/AGENTS.md`,
                  targetId: "codex",
                  content,
                  contentHash: hash(content),
                  observedHash: null,
                  observedContent: null,
                  ownedBefore: false,
                  reason: "Destination does not exist.",
                },
              ],
              protectedTargets: [],
              createdAt: "2026-07-24T12:00:00.000Z",
            },
          },
          exitCode: ExitCode.success,
        });
      },
    };

    const exitCode = await runCli(
      ["install", "/package", "--target", target],
      output.io,
      dryRunServices,
    );
    expect(exitCode).toBe(ExitCode.success);
    expect(output.stdout()).toContain(`[CREATE] ${target}/AGENTS.md`);
    expect(output.stdout()).toContain("Destination does not exist.");
    expect(output.stdout()).toContain(`Requested SHA-256: ${hash(content)}`);
    expect(output.stdout()).toContain("+new instruction");
    expect(output.stdout()).toContain('Exact requested content (utf8 JSON): "new instruction\\n"');
  });
});

#!/usr/bin/env node

import process from "node:process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { parseArgs } from "./args/parse.js";
import { renderHelp } from "./args/help.js";
import { EIB_VERSION, ExitCode, type CliCommand } from "./args/types.js";
import {
  CliServiceError,
  createCliServices,
  type CliServices,
} from "./services.js";
import { App } from "./tui/App.js";

export interface CliIo {
  readonly stdout: Pick<NodeJS.WriteStream, "write" | "isTTY">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeError(
  io: CliIo,
  json: boolean,
  code: string,
  message: string,
  details?: unknown,
): void {
  if (json) {
    io.stderr.write(
      serializeJson({
        ok: false,
        error: {
          code,
          message,
          ...(details === undefined ? {} : { details }),
        },
      }),
    );
    return;
  }
  io.stderr.write(`Error: ${message}\n`);
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.toLowerCase().includes("cancelled") ||
        error.message.toLowerCase().includes("canceled")))
  );
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  services: CliServices = createCliServices(),
): Promise<number> {
  let command: CliCommand;
  try {
    command = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const json = argv.includes("--json");
    writeError(io, json, "USAGE", message);
    if (!json) {
      io.stderr.write('Run "eib --help" for usage.\n');
    }
    return ExitCode.usage;
  }

  if (command.name === "help") {
    const help = renderHelp(command.topic);
    if (command.global.json) {
      io.stdout.write(serializeJson({ ok: true, command: "help", help }));
    } else {
      io.stdout.write(`${help}\n`);
    }
    return ExitCode.success;
  }
  if (command.name === "version") {
    if (command.global.json) {
      io.stdout.write(
        serializeJson({ ok: true, command: "version", version: EIB_VERSION }),
      );
    } else {
      io.stdout.write(`${EIB_VERSION}\n`);
    }
    return ExitCode.success;
  }

  const controller = new AbortController();
  const onSigint = (): void => {
    controller.abort(new DOMException("The operation was cancelled.", "AbortError"));
  };
  process.once("SIGINT", onSigint);
  try {
    if (command.name === "tui") {
      if (io.stdout.isTTY !== true || process.stdin.isTTY !== true) {
        writeError(
          io,
          false,
          "TTY_REQUIRED",
          'The interactive UI requires a terminal. Use "eib new --brief … --target …" in scripts.',
        );
        return ExitCode.usage;
      }
      const instance = render(
        createElement(App, {
          services,
          signal: controller.signal,
          onCancel: () => controller.abort(new DOMException("The operation was cancelled.", "AbortError")),
        }),
        { stdout: io.stdout as NodeJS.WriteStream },
      );
      await instance.waitUntilExit();
      return controller.signal.aborted ? ExitCode.cancelled : ExitCode.success;
    }

    const result = await services.execute(command, controller.signal);
    if (command.global.json) {
      io.stdout.write(
        serializeJson({
          ok: result.exitCode === ExitCode.success,
          status: result.status,
          command: command.name,
          message: result.message,
          data: result.data,
        }),
      );
    } else {
      io.stdout.write(`${result.message}\n`);
      if (result.display !== undefined) {
        io.stdout.write(`\n${result.display}`);
      }
      if (result.status === "needs_input" && result.data !== undefined) {
        io.stdout.write('Continue interactively with "eib" or provide the missing option.\n');
      }
    }
    return result.exitCode;
  } catch (error) {
    if (isCancellation(error, controller.signal)) {
      writeError(io, command.global.json, "CANCELLED", "The operation was cancelled.");
      return ExitCode.cancelled;
    }
    if (error instanceof CliServiceError) {
      writeError(
        io,
        command.global.json,
        error.exitCode === ExitCode.unavailable ? "UNAVAILABLE" : "COMMAND_FAILED",
        error.message,
        error.details,
      );
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeError(io, command.global.json, "COMMAND_FAILED", message);
    return ExitCode.error;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(realpathSync(resolve(invokedPath))).href === import.meta.url
) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}

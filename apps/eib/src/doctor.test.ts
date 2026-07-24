import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatDoctorReport, runDoctor } from "./doctor.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    }),
  );
});

async function createFakeDoctorExecutables(
  authentication: "authenticated" | "logged_out" = "authenticated",
): Promise<
  Record<"codex" | "claude" | "hermes" | "kimi", string>
> {
  const directory = await mkdtemp(join(tmpdir(), "eib-fake-doctor-"));
  cleanupPaths.push(directory);
  const source = `#!/usr/bin/env node
import { basename } from "node:path";

const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const authentication = ${JSON.stringify(authentication)};
if (args[0] === "--version") {
  process.stdout.write(command + " 1.2.3\\n");
} else if (command === "codex" && args.join(" ") === "login status") {
  if (authentication === "authenticated") {
    process.stdout.write("Logged in using ChatGPT\\n");
  } else {
    process.stderr.write("Not logged in\\n");
    process.exitCode = 1;
  }
} else if (command === "claude" && args.join(" ") === "auth status --json") {
  process.stdout.write(JSON.stringify({
    loggedIn: authentication === "authenticated",
    authMethod: authentication === "authenticated" ? "oauth" : "none"
  }));
} else {
  process.exitCode = 2;
}
`;
  const result = {} as Record<"codex" | "claude" | "hermes" | "kimi", string>;
  for (const id of ["codex", "claude", "hermes", "kimi"] as const) {
    const executable = join(directory, id);
    await writeFile(executable, source, { encoding: "utf8", mode: 0o700 });
    await chmod(executable, 0o700);
    result[id] = executable;
  }
  return result;
}

describe("doctor", () => {
  it("reports authenticated compiler CLIs and keeps Hermes/Kimi target-only", async () => {
    const executables = await createFakeDoctorExecutables();
    const report = await runDoctor({ executables });

    expect(report.readyCompilerBackends).toEqual(["codex", "claude"]);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.find((check) => check.id === "codex")).toMatchObject({
      installed: true,
      authenticated: true,
      compilerReady: true,
      role: "compiler",
    });
    expect(report.checks.find((check) => check.id === "claude")).toMatchObject({
      installed: true,
      authenticated: true,
      compilerReady: true,
      role: "compiler",
    });
    expect(report.checks.find((check) => check.id === "hermes")).toMatchObject({
      installed: true,
      authenticated: null,
      compilerReady: false,
      role: "target_only",
    });
    expect(report.checks.find((check) => check.id === "kimi")).toMatchObject({
      installed: true,
      authenticated: null,
      compilerReady: false,
      role: "target_only",
    });

    const text = formatDoctorReport(report);
    expect(text).toContain("Codex CLI: ready");
    expect(text).toContain("Kimi Code: target-only");
  });

  it("reports a missing executable without invoking a shell fallback", async () => {
    const executables = await createFakeDoctorExecutables();
    const missing = join(
      tmpdir(),
      `eib-does-not-exist-${basename(executables.codex)}-${Date.now()}`,
    );
    const report = await runDoctor({
      executables: { ...executables, codex: missing },
    });

    expect(report.readyCompilerBackends).toEqual(["claude"]);
    expect(report.checks.find((check) => check.id === "codex")).toMatchObject({
      installed: false,
      authenticated: null,
      compilerReady: false,
    });
  });

  it("keeps installed but unauthenticated compiler CLIs disabled", async () => {
    const executables = await createFakeDoctorExecutables("logged_out");
    const report = await runDoctor({ executables });

    expect(report.readyCompilerBackends).toEqual([]);
    expect(report.checks.find((check) => check.id === "codex")).toMatchObject({
      installed: true,
      authenticated: false,
      compilerReady: false,
    });
    expect(report.checks.find((check) => check.id === "claude")).toMatchObject({
      installed: true,
      authenticated: false,
      compilerReady: false,
    });
    expect(formatDoctorReport(report)).toContain(
      "Claude Code: not authenticated",
    );
  });
});

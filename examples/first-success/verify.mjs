import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const cli = resolve(exampleDirectory, "../../apps/eib/dist/cli.js");
const request = [
  "Create a Markdown CONTRIBUTING.md for repository contributors.",
  "Include setup, tests, and pull-request steps.",
  "Success is a concise, actionable guide.",
].join(" ");

async function run(project, ...args) {
  const { stdout } = await execFile(process.execPath, [cli, ...args], {
    cwd: project,
    env: { ...process.env, CODEX_THREAD_ID: undefined, EIB_RUNTIME_PROVIDER: undefined },
  });
  return JSON.parse(stdout);
}

const project = await mkdtemp(join(tmpdir(), "eib-first-success-"));

try {
  await writeFile(join(project, "package.json"), '{"name":"first-success-demo","private":true}\n');
  await writeFile(join(project, "README.md"), "# First-success demo\n");

  const installed = await run(project, "install", "--json");
  assert.equal(installed.status, "ok");
  assert.match(await readFile(join(project, ".eibrc.json"), "utf8"), /"version": 1/u);

  const preview = await run(project, "transform", request, "--for", "openai-gpt-5.6-codex", "--json");
  assert.equal(preview.status, "ok");
  assert.equal(preview.data.target.id, "openai-gpt-5.6-codex");
  assert.match(preview.message, /Confirmation required/u);
  assert.equal(typeof preview.data.runToken, "string");
  assert.ok(preview.data.context.entries.some((entry) => entry.path === "README.md" && entry.included));

  const handoff = await run(project, "confirm", preview.data.runToken, "--json");
  assert.equal(handoff.status, "ok");
  assert.equal(handoff.data.runToken, preview.data.runToken);
  assert.match(handoff.data.handoff, /^# EIB execution contract/mu);
  assert.match(handoff.data.handoff, /CONTRIBUTING\.md/u);

  console.log("First-success lifecycle passed: install, preview, confirmation, and handoff.");
} finally {
  await rm(project, { recursive: true, force: true });
}

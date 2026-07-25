import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runtimeAdapterCapabilities, runtimeTargetCapabilities } from "./runtime.js";

const MANAGED_MARKER = "<!-- Managed by Explain It Better. -->";
const CONFIG_VERSION = 1;

export interface InstallResult {
  readonly root: string;
  readonly created: readonly string[];
  readonly existing: readonly string[];
  readonly capabilities: typeof runtimeAdapterCapabilities;
  readonly targetCapabilities: ReturnType<typeof runtimeTargetCapabilities>;
}

function codexSkill(): string {
  return `---
name: explain-it-better
description: Transform a natural project request into a target-aware, project-contextual agent brief. Use when a user invokes /eib or asks to improve a vague implementation request.
---

${MANAGED_MARKER}

# Explain It Better

Run \`eib transform --runtime auto "<the user's request>"\` for normal requests.
Run \`eib transform --runtime auto --deep "<the user's request>"\` only when the user explicitly invokes \`/eib-deep\`.

Show the preview, target, selected context, and assumptions. Do not start work until the user confirms the returned run token. On confirmation, run \`eib confirm <token>\` and treat the returned handoff brief as the active task.
`;
}

function claudeCommand(deep: boolean): string {
  const command = deep ? "eib-deep" : "eib";
  return `${MANAGED_MARKER}

Use Explain It Better for the user's request. Run \`eib transform --runtime auto${deep ? " --deep" : ""} "$ARGUMENTS"\`.

Present the compiled brief preview and its run token. Do not execute the brief until the user confirms. After confirmation, run \`eib confirm <token>\` and follow its handoff text as the task instructions.

This command is \`/${command}\`.
`;
}

function openAiMetadata(): string {
  return `# ${MANAGED_MARKER}
interface:
  display_name: "Explain It Better"
  short_description: "Compile natural project requests into target-aware agent briefs."
  default_prompt: "Use EIB to transform this request into a project-aware agent brief."
`;
}

async function ensureManagedFile(
  root: string,
  relativePath: string,
  content: string,
  created: string[],
  existing: string[],
): Promise<void> {
  const path = join(root, relativePath);
  try {
    const current = await readFile(path, "utf8");
    if (!current.includes(MANAGED_MARKER)) {
      throw new Error(`Refusing to overwrite unowned install asset ${relativePath}.`);
    }
    existing.push(relativePath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  created.push(relativePath);
}

/** Install only EIB-owned project assets; never modify existing agent instructions. */
export async function installProjectRuntime(rootInput: string): Promise<InstallResult> {
  const root = resolve(rootInput);
  const created: string[] = [];
  const existing: string[] = [];
  const configPath = join(root, ".eibrc.json");
  try {
    await readFile(configPath, "utf8");
    existing.push(".eibrc.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(
      configPath,
      `${JSON.stringify({ version: CONFIG_VERSION }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );
    created.push(".eibrc.json");
  }

  await ensureManagedFile(root, ".codex/skills/explain-it-better/SKILL.md", codexSkill(), created, existing);
  await ensureManagedFile(root, ".codex/skills/explain-it-better/agents/openai.yaml", openAiMetadata(), created, existing);
  await ensureManagedFile(root, ".claude/commands/eib.md", claudeCommand(false), created, existing);
  await ensureManagedFile(root, ".claude/commands/eib-deep.md", claudeCommand(true), created, existing);
  return {
    root,
    created,
    existing,
    capabilities: runtimeAdapterCapabilities,
    targetCapabilities: runtimeTargetCapabilities(),
  };
}

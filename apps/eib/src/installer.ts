import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runtimeAdapterCapabilities, runtimeTargetCapabilities } from "./runtime.js";

const MANAGED_MARKER = "Managed by Explain It Better.";
const CONFIG_VERSION = 1;
const INSTALL_ASSET_VERSION = 3;

export interface InstallResult {
  readonly root: string;
  readonly created: readonly string[];
  readonly updated: readonly string[];
  /** Existing assets that were already current, or were left untouched by a normal install. */
  readonly existing: readonly string[];
  /** EIB-managed assets whose contents were edited locally and were therefore not overwritten. */
  readonly preserved: readonly string[];
  readonly capabilities: typeof runtimeAdapterCapabilities;
  readonly targetCapabilities: ReturnType<typeof runtimeTargetCapabilities>;
}

export interface InstallOptions {
  /** Refresh only unmodified EIB-owned integration assets. */
  readonly update?: boolean;
}

interface InstallAsset {
  readonly path: string;
  readonly assetId: string;
  readonly content: string;
  readonly legacyContent: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownAsset(assetId: string, body: string): string {
  return `<!-- ${MANAGED_MARKER} -->\n<!-- EIB-ASSET: ${assetId}; VERSION: ${INSTALL_ASSET_VERSION}; SHA256: ${sha256(body)} -->\n${body}`;
}

/** Codex skills require YAML front matter to remain the first document bytes. */
function codexSkillAsset(assetId: string, body: string): string {
  const opening = "---\n";
  if (!body.startsWith(opening)) throw new Error("Codex skill content must start with YAML front matter.");
  return `${opening}# ${MANAGED_MARKER}\n# EIB-ASSET: ${assetId}; VERSION: ${INSTALL_ASSET_VERSION}; SHA256: ${sha256(body)}\n${body.slice(opening.length)}`;
}

function yamlAsset(assetId: string, body: string): string {
  return `# ${MANAGED_MARKER}\n# EIB-ASSET: ${assetId}; VERSION: ${INSTALL_ASSET_VERSION}; SHA256: ${sha256(body)}\n${body}`;
}

async function portableSkillBody(): Promise<string> {
  return readFile(new URL("../skills/explain-it-better/SKILL.md", import.meta.url), "utf8");
}

function claudeCommandBody(deep: boolean): string {
  const command = deep ? "eib-deep" : "eib";
  return `Use Explain It Better for the user's request. Run \`eib transform --runtime auto${deep ? " --deep" : ""} "$ARGUMENTS"\`.

Present the compiled brief preview and its run token. Do not execute the brief until the user confirms. After confirmation, run \`eib confirm <token>\` and follow its handoff text as the task instructions.

This command is \`/${command}\`.
`;
}

async function openAiMetadataBody(): Promise<string> {
  return readFile(new URL("../skills/explain-it-better/agents/openai.yaml", import.meta.url), "utf8");
}

function legacyClaudeCommand(deep: boolean): string {
  return `<!-- Managed by Explain It Better. -->\n\n${claudeCommandBody(deep)}`;
}

async function installAssets(): Promise<readonly InstallAsset[]> {
  const portableSkill = await portableSkillBody();
  const regularClaude = claudeCommandBody(false);
  const deepClaude = claudeCommandBody(true);
  const metadata = await openAiMetadataBody();
  return [
    {
      path: ".agents/skills/explain-it-better/SKILL.md",
      assetId: "portable-agent-skill",
      content: codexSkillAsset("portable-agent-skill", portableSkill),
      legacyContent: "",
    },
    {
      path: ".agents/skills/explain-it-better/agents/openai.yaml",
      assetId: "portable-agent-skill-metadata",
      content: yamlAsset("portable-agent-skill-metadata", metadata),
      legacyContent: "",
    },
    {
      path: ".codex/skills/explain-it-better/SKILL.md",
      assetId: "codex-skill",
      content: codexSkillAsset("codex-skill", portableSkill),
      legacyContent: "",
    },
    {
      path: ".codex/skills/explain-it-better/agents/openai.yaml",
      assetId: "codex-openai-metadata",
      content: yamlAsset("codex-openai-metadata", metadata),
      legacyContent: "",
    },
    {
      path: ".claude/skills/explain-it-better/SKILL.md",
      assetId: "claude-skill",
      content: codexSkillAsset("claude-skill", portableSkill),
      legacyContent: "",
    },
    {
      path: ".claude/commands/eib.md",
      assetId: "claude-command-eib",
      content: markdownAsset("claude-command-eib", regularClaude),
      legacyContent: legacyClaudeCommand(false),
    },
    {
      path: ".claude/commands/eib-deep.md",
      assetId: "claude-command-eib-deep",
      content: markdownAsset("claude-command-eib-deep", deepClaude),
      legacyContent: legacyClaudeCommand(true),
    },
  ];
}

function isEibOwnedAsset(content: string): boolean {
  return content.includes(MANAGED_MARKER);
}

/**
 * A fingerprint covers every byte except the two generated management lines.
 * This lets a later EIB release update only assets that users have not edited.
 */
function isVerifiedManagedAsset(content: string, assetId: string): boolean {
  const match = content.match(
    new RegExp(`(?:<!--|#) EIB-ASSET: ${assetId}; VERSION: (\\d+); SHA256: ([a-f0-9]{64})(?:\\s*-->)?\\n`),
  );
  if (match === null) return false;
  const declaredHash = match[2];
  const withoutManagement = content
    .replace(/(?:<!--|#) Managed by Explain It Better\. ?(?:-->)?\n/, "")
    .replace(match[0], "");
  return declaredHash === sha256(withoutManagement);
}

async function installAsset(
  root: string,
  asset: InstallAsset,
  options: InstallOptions,
  result: { created: string[]; updated: string[]; existing: string[]; preserved: string[] },
): Promise<void> {
  const path = join(root, asset.path);
  try {
    const current = await readFile(path, "utf8");
    if (!isEibOwnedAsset(current)) {
      throw new Error(`Refusing to overwrite unowned install asset ${asset.path}.`);
    }
    if (current === asset.content) {
      result.existing.push(asset.path);
      return;
    }
    if (!options.update) {
      result.existing.push(asset.path);
      return;
    }
    if (current !== asset.legacyContent && !isVerifiedManagedAsset(current, asset.assetId)) {
      result.preserved.push(asset.path);
      return;
    }
    await writeFile(path, asset.content, { encoding: "utf8", mode: 0o644 });
    result.updated.push(asset.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await writeFile(path, asset.content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    result.created.push(asset.path);
  }
}

/** Install only EIB-owned project assets; `--update` never overwrites local edits. */
export async function installProjectRuntime(
  rootInput: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const root = resolve(rootInput);
  const created: string[] = [];
  const updated: string[] = [];
  const existing: string[] = [];
  const preserved: string[] = [];
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

  const result = { created, updated, existing, preserved };
  for (const asset of await installAssets()) {
    await installAsset(root, asset, options, result);
  }
  return {
    root,
    ...result,
    capabilities: runtimeAdapterCapabilities,
    targetCapabilities: runtimeTargetCapabilities(),
  };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");
const sourceFiles = [
  "SKILL.md",
  "agents/openai.yaml",
];
const destinations = [
  { path: "apps/eib/skills/explain-it-better", files: sourceFiles },
  { path: "plugins/explain-it-better/skills/explain-it-better", files: sourceFiles },
  // Claude Code consumes SKILL.md only; OpenAI app metadata is not a Claude
  // plugin contract and must not be shipped as dead distribution surface.
  { path: "claude-plugin/explain-it-better/skills/explain-it-better", files: ["SKILL.md"] },
];

const sourceRoot = resolve(root, "skills/explain-it-better");
const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const releaseVersion = rootPackage.version;
if (typeof releaseVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(releaseVersion)) {
  throw new Error("Root package version must be a semantic version.");
}
const versionedPackages = ["apps/eib/package.json", "packages/core/package.json", "packages/knowledge/package.json"];
for (const relativePath of versionedPackages) {
  const manifest = JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
  if (manifest.version !== releaseVersion) {
    throw new Error(`${relativePath} must match root release version ${releaseVersion}.`);
  }
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith("@eib/") && version !== releaseVersion) {
      throw new Error(`${relativePath} dependency ${name} must match root release version ${releaseVersion}.`);
    }
  }
}
const cliTypes = await readFile(resolve(root, "apps/eib/src/args/types.ts"), "utf8");
if (!cliTypes.includes(`EIB_VERSION = "${releaseVersion}"`)) {
  throw new Error("CLI runtime version must match the root package version.");
}
const contents = await Promise.all(sourceFiles.map(async (file) => [
  file,
  await readFile(resolve(sourceRoot, file), "utf8"),
]));
const canonicalSkill = contents.find(([file]) => file === "SKILL.md")?.[1];
if (canonicalSkill === undefined) throw new Error("The canonical EIB Skill is missing.");
for (const required of ["## EIB preview — awaiting confirmation", "Wait for explicit approval", "Keep the skill portable"]) {
  if (!canonicalSkill.includes(required)) {
    throw new Error(`The canonical EIB Skill is missing its required portable-contract section: ${required}.`);
  }
}
for (const forbidden of [/`eib(?:-mcp)?\b/u, /eib_prepare/u, /eib_confirm/u]) {
  if (forbidden.test(canonicalSkill)) {
    throw new Error(`The canonical EIB Skill has a forbidden runtime dependency: ${forbidden.source}.`);
  }
}

const stale = [];
for (const destination of destinations) {
  for (const [file, expected] of contents) {
    if (!destination.files.includes(file)) continue;
    const target = resolve(root, destination.path, file);
    let current;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current === expected) continue;
    if (checkOnly) {
      stale.push(`${destination.path}/${file}`);
      continue;
    }
    await mkdir(resolve(root, destination.path, file, ".."), { recursive: true });
    await writeFile(target, expected, "utf8");
  }
}

if (stale.length > 0) {
  throw new Error(`Generated skill distributions are stale: ${stale.join(", ")}. Run npm run skills:sync.`);
}

if (checkOnly) {
  const plugin = JSON.parse(await readFile(resolve(root, "plugins/explain-it-better/.codex-plugin/plugin.json"), "utf8"));
  if (plugin.version !== releaseVersion) {
    throw new Error("The Codex plugin must match the root release version.");
  }
  if (plugin.mcpServers !== undefined || plugin.apps !== undefined) {
    throw new Error("The core Codex/ChatGPT plugin must remain skills-only.");
  }
  if (plugin.skills !== "./skills/") {
    throw new Error("The core Codex/ChatGPT plugin must expose its canonical skills directory.");
  }
  const marketplace = JSON.parse(await readFile(resolve(root, ".agents/plugins/marketplace.json"), "utf8"));
  const entry = marketplace.plugins?.find((item) => item.name === "explain-it-better");
  if (entry?.source?.path !== "./plugins/explain-it-better") {
    throw new Error("The local marketplace must point to the Explain It Better plugin source.");
  }
  const claudePlugin = JSON.parse(await readFile(resolve(root, "claude-plugin/explain-it-better/.claude-plugin/plugin.json"), "utf8"));
  const claudeMarketplace = JSON.parse(await readFile(resolve(root, ".claude-plugin/marketplace.json"), "utf8"));
  const claudeEntry = claudeMarketplace.plugins?.find((item) => item.name === "explain-it-better");
  if (claudeMarketplace.name !== "explain-it-better" || claudeEntry?.source !== "./claude-plugin/explain-it-better") {
    throw new Error("The public Claude marketplace must expose the standalone Explain It Better plugin.");
  }
  if (claudeMarketplace.version !== claudePlugin.version || claudeEntry.version !== claudePlugin.version) {
    throw new Error("The public Claude marketplace and its plugin must share one release version.");
  }
  if (claudePlugin.version !== releaseVersion) {
    throw new Error("The Claude plugin and marketplace must match the root release version.");
  }
}

process.stdout.write(`Explain It Better skill distributions ${checkOnly ? "verified" : "synchronized"}.\n`);

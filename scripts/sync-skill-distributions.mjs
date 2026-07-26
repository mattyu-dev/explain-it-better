import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");
const sourceFiles = [
  "SKILL.md",
  "agents/openai.yaml",
];
const destinations = [
  "apps/eib/skills/explain-it-better",
  "plugins/explain-it-better/skills/explain-it-better",
  "claude-plugin/explain-it-better/skills/explain-it-better",
];

const sourceRoot = resolve(root, "skills/explain-it-better");
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
    const target = resolve(root, destination, file);
    let current;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current === expected) continue;
    if (checkOnly) {
      stale.push(`${destination}/${file}`);
      continue;
    }
    await mkdir(resolve(root, destination, file, ".."), { recursive: true });
    await writeFile(target, expected, "utf8");
  }
}

if (stale.length > 0) {
  throw new Error(`Generated skill distributions are stale: ${stale.join(", ")}. Run npm run skills:sync.`);
}

if (checkOnly) {
  const plugin = JSON.parse(await readFile(resolve(root, "plugins/explain-it-better/.codex-plugin/plugin.json"), "utf8"));
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
}

process.stdout.write(`Explain It Better skill distributions ${checkOnly ? "verified" : "synchronized"}.\n`);

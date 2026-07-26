#!/usr/bin/env node

/**
 * Dependency-free structural validation for this distributable plugin.
 * Claude Code's own validator remains the authority for host compatibility:
 *   claude plugin validate <plugin-directory>
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pluginRoot, ".claude-plugin", "plugin.json");
const skillPath = join(pluginRoot, "skills", "explain-it-better", "SKILL.md");

const failures = [];

async function requiredFile(path, label) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) failures.push(`${label} must be a file: ${path}`);
  } catch {
    failures.push(`Missing ${label}: ${path}`);
  }
}

await Promise.all([
  requiredFile(manifestPath, "plugin manifest"),
  requiredFile(skillPath, "skill entrypoint"),
]);

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  failures.push(`Invalid plugin manifest JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.name !== "explain-it-better") {
    failures.push('Manifest "name" must be "explain-it-better".');
  }
  if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
    failures.push('Manifest requires a non-empty "description".');
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    failures.push('Manifest "version" must be a semantic version.');
  }
}

let skill = "";
try {
  skill = await readFile(skillPath, "utf8");
} catch {
  // The missing-file failure above is more useful.
}

if (!skill.startsWith("---\n") || !/^name:\s*explain-it-better\s*$/m.test(skill) || !/^description:\s*.+$/m.test(skill)) {
  failures.push("SKILL.md must start with YAML frontmatter containing name and description.");
}
if (/\beib_(prepare|confirm)\b|\beib-mcp\b/.test(skill)) {
  failures.push("Standalone SKILL.md must not depend on EIB MCP tools.");
}

if (failures.length > 0) {
  console.error("Explain It Better Claude plugin validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Explain It Better Claude plugin structure is valid.");
  console.log(`Plugin root: ${pluginRoot}`);
}

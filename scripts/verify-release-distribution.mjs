#!/usr/bin/env node

/**
 * Verify that the checked-out release commit is the source served by the
 * release tag and that every install surface points at the same version.
 *
 * This is intentionally a post-tag check. `skills:check` must remain usable
 * while preparing the next release, before its tag exists.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const remoteFlag = process.argv.indexOf("--remote");
const remote = remoteFlag === -1 ? "origin" : process.argv[remoteFlag + 1];
if (!/^[A-Za-z0-9._/-]+$/u.test(remote ?? "")) {
  throw new Error("Use a simple Git remote name with --remote.");
}

const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
};
const requirePathAtHead = (path) => {
  try {
    git(["cat-file", "-e", `HEAD:${path}`]);
  } catch {
    throw new Error(`Release source is missing required path: ${path}.`);
  }
};
const hasUncommittedChanges = (paths) => {
  try {
    git(["diff", "--quiet", "HEAD", "--", ...paths]);
    return false;
  } catch (error) {
    if (error?.status === 1) return true;
    throw error;
  }
};

const rootPackage = await readJson("package.json");
const version = rootPackage.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error("Root package version must be semantic version.");
}
const tag = `v${version}`;
const head = git(["rev-parse", "HEAD"]);

let localTagType;
try {
  localTagType = git(["cat-file", "-t", `refs/tags/${tag}`]);
} catch {
  throw new Error(`Local checkout is missing the ${tag} tag.`);
}
if (localTagType !== "tag") {
  throw new Error(`Release ${tag} must use an annotated tag, not ${localTagType}.`);
}

// `ls-remote` verifies the public source pointer without mutating local refs.
// A release must be annotated, so it must expose a peeled commit line.
const remoteTagLines = git(["ls-remote", "--tags", remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [objectId, ref] = line.split("\t");
    return { objectId, ref };
  });
const remoteTag = remoteTagLines.find(({ ref }) => ref === `refs/tags/${tag}^{}`);
if (remoteTag === undefined) throw new Error(`Remote ${remote} must expose an annotated ${tag} tag.`);
equal(remoteTag.objectId, head, `${remote} ${tag} must resolve to this checkout`);

const requiredPaths = [
  "package.json",
  "package-lock.json",
  "apps/eib/package.json",
  "packages/core/package.json",
  "packages/knowledge/package.json",
  "plugins/explain-it-better/.codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "claude-plugin/explain-it-better/.claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "skills/explain-it-better/SKILL.md",
  "skills/explain-it-better/agents/openai.yaml",
  "apps/eib/skills/explain-it-better/SKILL.md",
  "apps/eib/skills/explain-it-better/agents/openai.yaml",
  "plugins/explain-it-better/skills/explain-it-better/SKILL.md",
  "plugins/explain-it-better/skills/explain-it-better/agents/openai.yaml",
  "claude-plugin/explain-it-better/skills/explain-it-better/SKILL.md",
  "apps/eib/src/cli.ts",
  "apps/eib/src/mcp.ts",
];
for (const path of requiredPaths) requirePathAtHead(path);
if (hasUncommittedChanges(requiredPaths)) {
  throw new Error("Release-distribution files have uncommitted changes.");
}

equal(rootPackage.private, true, "Power-mode root package must remain private");
if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes("apps/*") || !rootPackage.workspaces.includes("packages/*")) {
  throw new Error("Power-mode source install must retain the apps and packages workspaces.");
}
for (const [name, script] of [["build", "npm run skills:sync"], ["plugins:check", "npm run skills:check"], ["release:check", "npm run plugins:check"]]) {
  if (typeof rootPackage.scripts?.[name] !== "string" || !rootPackage.scripts[name].includes(script)) {
    throw new Error(`Power-mode root package is missing the required ${name} script contract.`);
  }
}

const [cliPackage, corePackage, knowledgePackage, codexPlugin, codexMarketplace, claudePlugin, claudeMarketplace, lockfile] = await Promise.all([
  readJson("apps/eib/package.json"),
  readJson("packages/core/package.json"),
  readJson("packages/knowledge/package.json"),
  readJson("plugins/explain-it-better/.codex-plugin/plugin.json"),
  readJson(".agents/plugins/marketplace.json"),
  readJson("claude-plugin/explain-it-better/.claude-plugin/plugin.json"),
  readJson(".claude-plugin/marketplace.json"),
  readJson("package-lock.json"),
]);
for (const [label, manifest] of [["CLI", cliPackage], ["core", corePackage], ["knowledge", knowledgePackage]]) {
  equal(manifest.version, version, `${label} package version`);
  equal(manifest.private, true, `${label} package must remain private`);
}
equal(cliPackage.bin?.eib, "./dist/cli.js", "Power-mode CLI binary");
equal(cliPackage.bin?.["eib-mcp"], "./dist/mcp.js", "Power-mode MCP binary");
for (const dependency of ["@eib/core", "@eib/knowledge"]) {
  equal(cliPackage.dependencies?.[dependency], version, `CLI ${dependency} dependency`);
}
equal(lockfile.packages?.[""]?.version, version, "Lockfile root version");
equal(lockfile.packages?.["apps/eib"]?.version, version, "Lockfile CLI version");

equal(codexPlugin.version, version, "Codex plugin version");
equal(codexPlugin.skills, "./skills/", "Codex plugin skill source");
const codexEntry = codexMarketplace.plugins?.find((entry) => entry.name === "explain-it-better");
equal(codexEntry?.source?.source, "local", "Codex marketplace source type");
equal(codexEntry?.source?.path, "./plugins/explain-it-better", "Codex marketplace source path");
equal(claudePlugin.version, version, "Claude plugin version");
equal(claudeMarketplace.version, version, "Claude marketplace version");
const claudeEntry = claudeMarketplace.plugins?.find((entry) => entry.name === "explain-it-better");
equal(claudeEntry?.version, version, "Claude marketplace entry version");
equal(claudeEntry?.source, "./claude-plugin/explain-it-better", "Claude marketplace source path");

const canonicalSkill = await readFile(resolve(root, "skills/explain-it-better/SKILL.md"), "utf8");
const canonicalMetadata = await readFile(resolve(root, "skills/explain-it-better/agents/openai.yaml"), "utf8");
for (const path of [
  "apps/eib/skills/explain-it-better/SKILL.md",
  "plugins/explain-it-better/skills/explain-it-better/SKILL.md",
  "claude-plugin/explain-it-better/skills/explain-it-better/SKILL.md",
]) {
  equal(await readFile(resolve(root, path), "utf8"), canonicalSkill, `${path} must match canonical Skill`);
}
for (const path of [
  "apps/eib/skills/explain-it-better/agents/openai.yaml",
  "plugins/explain-it-better/skills/explain-it-better/agents/openai.yaml",
]) {
  equal(await readFile(resolve(root, path), "utf8"), canonicalMetadata, `${path} must match canonical metadata`);
}

process.stdout.write(`Release distribution verified: ${tag} (${head}) is the ${remote} tag and every install surface matches ${version}.\n`);

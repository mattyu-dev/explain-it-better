import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function readTagName() {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf("--tag");
  if (tagIndex === -1) {
    if (args.length > 0) {
      throw new Error(`Unknown argument(s): ${args.join(" ")}. Use --tag vX.Y.Z.`);
    }
    return process.env.GITHUB_REF_NAME;
  }
  if (args.length !== 2 || tagIndex !== 0 || args[1] === undefined) {
    throw new Error("Use exactly one tag argument: --tag vX.Y.Z.");
  }
  return args[1];
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectVersion(issues, location, actual, expected) {
  if (actual !== expected) {
    issues.push(`${location} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`);
  }
}

const tag = readTagName();
if (typeof tag !== "string") {
  throw new Error("A release tag is required. Pass --tag vX.Y.Z or set GITHUB_REF_NAME.");
}
const tagMatch = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(tag);
if (tagMatch === null) {
  throw new Error(`Release tag must use the vX.Y.Z form; received ${JSON.stringify(tag)}.`);
}
const version = tag.slice(1);
if (!semver.test(version)) {
  throw new Error(`Release tag ${JSON.stringify(tag)} does not contain a valid X.Y.Z semantic version.`);
}

const [rootManifest, cliManifest, coreManifest, knowledgeManifest, lockfile, codexPlugin, claudePlugin, claudeMarketplace] =
  await Promise.all([
    readJson("package.json"),
    readJson("apps/eib/package.json"),
    readJson("packages/core/package.json"),
    readJson("packages/knowledge/package.json"),
    readJson("package-lock.json"),
    readJson("plugins/explain-it-better/.codex-plugin/plugin.json"),
    readJson("claude-plugin/explain-it-better/.claude-plugin/plugin.json"),
    readJson(".claude-plugin/marketplace.json"),
  ]);
const [cliTypes, changelog] = await Promise.all([
  readFile(resolve(root, "apps/eib/src/args/types.ts"), "utf8"),
  readFile(resolve(root, "CHANGELOG.md"), "utf8"),
]);

const issues = [];
for (const [path, manifest] of [
  ["package.json", rootManifest],
  ["apps/eib/package.json", cliManifest],
  ["packages/core/package.json", coreManifest],
  ["packages/knowledge/package.json", knowledgeManifest],
  ["plugins/explain-it-better/.codex-plugin/plugin.json", codexPlugin],
  ["claude-plugin/explain-it-better/.claude-plugin/plugin.json", claudePlugin],
  [".claude-plugin/marketplace.json", claudeMarketplace],
]) {
  expectVersion(issues, `${path} version`, manifest.version, version);
}

for (const [index, plugin] of (claudeMarketplace.plugins ?? []).entries()) {
  expectVersion(issues, `.claude-plugin/marketplace.json plugins[${index}].version`, plugin?.version, version);
}

for (const [path, manifest, dependencies] of [
  ["apps/eib/package.json", cliManifest, ["@eib/core", "@eib/knowledge"]],
  ["packages/knowledge/package.json", knowledgeManifest, ["@eib/core"]],
]) {
  for (const dependency of dependencies) {
    expectVersion(issues, `${path} dependencies.${dependency}`, manifest.dependencies?.[dependency], version);
  }
}

for (const path of ["", "apps/eib", "packages/core", "packages/knowledge"]) {
  const lockPackage = lockfile.packages?.[path];
  const label = path === "" ? "package-lock.json packages[\"\"]" : `package-lock.json packages.${path}`;
  expectVersion(issues, `${label} version`, lockPackage?.version, version);
}
for (const [path, dependencies] of [
  ["apps/eib", ["@eib/core", "@eib/knowledge"]],
  ["packages/knowledge", ["@eib/core"]],
]) {
  for (const dependency of dependencies) {
    expectVersion(
      issues,
      `package-lock.json packages.${path} dependencies.${dependency}`,
      lockfile.packages?.[path]?.dependencies?.[dependency],
      version,
    );
  }
}

if (!cliTypes.includes(`EIB_VERSION = "${version}"`)) {
  issues.push(`apps/eib/src/args/types.ts EIB_VERSION must be ${JSON.stringify(version)}.`);
}
if (!new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\](?:\\s|$)`, "mu").test(changelog)) {
  issues.push(`CHANGELOG.md must contain a release heading for ${JSON.stringify(version)}.`);
}

if (issues.length > 0) {
  throw new Error(`Release integrity validation failed for ${tag}:\n- ${issues.join("\n- ")}`);
}

process.stdout.write(`Release integrity verified: ${tag} matches all shipped manifests and runtime versions.\n`);

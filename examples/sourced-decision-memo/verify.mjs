import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(process.argv[2] ?? resolve(exampleDirectory, "package"));
const fixturesPath = resolve(exampleDirectory, "static-fixtures.json");
const evalsPath = resolve(packageDirectory, "evals.jsonl");

const fixtureValue = JSON.parse(await readFile(fixturesPath, "utf8"));
if (
  typeof fixtureValue !== "object" ||
  fixtureValue === null ||
  Array.isArray(fixtureValue) ||
  Object.values(fixtureValue).some((value) => typeof value !== "string" || value.length === 0)
) {
  throw new Error("static-fixtures.json must be an object with non-empty string outputs.");
}

const evalCases = (await readFile(evalsPath, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const caseIds = evalCases.map((evalCase) => evalCase.id);
if (!caseIds.every((id) => typeof id === "string") || new Set(caseIds).size !== caseIds.length) {
  throw new Error(`Invalid or duplicate evaluation IDs in ${evalsPath}.`);
}

const fixtureIds = Object.keys(fixtureValue);
const missing = caseIds.filter((id) => !(id in fixtureValue));
const unexpected = fixtureIds.filter((id) => !caseIds.includes(id));
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `Static fixture coverage mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
  );
}

console.log(`Fixture coverage passed: ${caseIds.length} evaluation cases in ${packageDirectory}.`);

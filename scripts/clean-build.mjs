import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = [
  resolve(root, "apps/eib/dist"),
  resolve(root, "packages/core/dist"),
  resolve(root, "packages/knowledge/dist"),
];

for (const target of targets) {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..")) {
    throw new Error(`Refusing to remove build output outside the workspace: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

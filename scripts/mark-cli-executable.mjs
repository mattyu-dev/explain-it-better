import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const binaries = [
  resolve(root, "apps/eib/dist/cli.js"),
  resolve(root, "apps/eib/dist/mcp.js"),
];

await Promise.all(binaries.map((binary) => chmod(binary, 0o755)));

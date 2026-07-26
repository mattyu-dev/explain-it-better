import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "apps/eib/dist/cli.js");

await chmod(cli, 0o755);

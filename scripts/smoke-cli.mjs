import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "eib-cli-smoke-"));
const linkedCli = join(directory, "eib");

try {
  await symlink(resolve(root, "apps/eib/dist/cli.js"), linkedCli);
  const output = execFileSync(linkedCli, ["--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (!output.includes("eib transform [request]")) {
    throw new Error("The npm-linked eib CLI did not render its help output.");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

process.stdout.write("eib CLI entrypoint symlink smoke test passed\n");

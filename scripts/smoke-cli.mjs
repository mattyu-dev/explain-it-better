import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["exec", "--", "eib", "--help"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if (!output.includes("eib transform [request]")) {
  throw new Error("The npm-linked eib CLI did not render its help output.");
}

process.stdout.write("npm-linked eib CLI smoke test passed\n");

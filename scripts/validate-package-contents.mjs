import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const workspaces = [
  {
    name: "@eib/core",
    required: ["dist/index.js", "dist/index.d.ts", "package.json"],
  },
  {
    name: "@eib/knowledge",
    required: ["dist/index.js", "dist/index.d.ts", "package.json"],
  },
  {
    name: "@eib/cli",
    required: ["dist/cli.js", "dist/cli.d.ts", "dist/mcp.js", "dist/mcp.d.ts", "skills/explain-it-better/SKILL.md", "skills/explain-it-better/agents/openai.yaml", "package.json"],
  },
];

const forbiddenPath = (path) =>
  path.includes(".test.") ||
  path.endsWith(".tsbuildinfo") ||
  path.includes("test-fixtures");

const root = resolve(import.meta.dirname, "..");
for (const binary of ["cli.js", "mcp.js"]) {
  const mode = statSync(resolve(root, "apps/eib/dist", binary)).mode;
  if ((mode & 0o111) === 0) {
    throw new Error(`@eib/cli dist/${binary} must be executable so npm-linked commands work.`);
  }
}

for (const workspace of workspaces) {
  const raw = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--workspace", workspace.name],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const reports = JSON.parse(raw);
  const report = reports[0];
  if (reports.length !== 1 || report === undefined) {
    throw new Error(`Expected one npm pack report for ${workspace.name}.`);
  }
  const paths = new Set(report.files.map((file) => file.path));
  const forbidden = [...paths].filter(forbiddenPath);
  const missing = workspace.required.filter((path) => !paths.has(path));
  if (forbidden.length > 0 || missing.length > 0) {
    throw new Error(
      [
        `Invalid package contents for ${workspace.name}.`,
        ...(forbidden.length === 0
          ? []
          : [`Forbidden files: ${forbidden.join(", ")}`]),
        ...(missing.length === 0
          ? []
          : [`Missing runtime files: ${missing.join(", ")}`]),
      ].join(" "),
    );
  }
  process.stdout.write(
    `${workspace.name}: ${String(report.entryCount)} runtime package files validated\n`,
  );
}

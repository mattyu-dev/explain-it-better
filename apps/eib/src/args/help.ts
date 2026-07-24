const commandHelp: Readonly<Record<string, string>> = {
  new: `Usage: eib new [brief] [options]

Turn a brief into an intent contract and agent blueprint.

Options:
  --brief <text>          Brief (alternative to positional text)
  --target <id>           Compile a target; repeat for multiple targets
  --schema <JSON object>  Structured output schema
  --tools <JSON array>    Canonical tool specifications
  --mcp-servers <JSON array>
                         Declarative MCP server specs; EIB never starts them
  --fast                  Accept visible recommended assumptions
  --output <path>         Write the package to this path
  --json                  Emit one machine-readable JSON document`,
  improve: `Usage: eib improve <package> [options]

Options:
  --feedback <text>       Material correction or desired improvement
  --fast                  Accept visible recommended assumptions
  --output <path>         Write a new package rather than replacing input
  --json                  Emit one machine-readable JSON document`,
  optimize: `Usage: eib optimize [package] [options]

Generate one to three frozen-intent candidates and a held-out evaluation plan.
With --runs, make a fail-closed promotion recommendation from imported evidence.
The source package and its verification status are never changed.

Options:
  --max-candidates 1|2|3     Candidate count (default: 3)
  --runs <json-file>         Candidate evaluation runs for every generated candidate
  --comparisons <json-file>  Optional blinded comparisons; both orders required per case
  --minimum-improvement <n>  Strict score delta needed to promote (default: 0)
  --output <path>            Exclusively write the plan or promotion evidence JSON
  --json                     Emit one machine-readable JSON document`,
  compile: `Usage: eib compile [package] --target <id> [options]

The package defaults to .eib/package.json.

Options:
  --target <id>           Required; repeat for multiple targets
  --output <path>         Write the updated package to this path
  --json                  Emit one machine-readable JSON document`,
  eval: `Usage: eib eval [package] [options]

The package defaults to .eib/package.json.

Options:
  --mode static|proxy|live
  --depth quick|default|deep  Repetitions for proxy/live modes
  --backend codex|claude  Required for proxy mode
  --fixtures <json-file>  Static outputs keyed by every evaluation case ID
  --allow-execution       Explicit consent required for proxy mode
  --json                  Emit one machine-readable JSON document`,
  export: `Usage: eib export [package] --format directory|clipboard [options]

Options:
  --output <directory>    Required for directory export
  --json                  Emit one machine-readable JSON document`,
  install: `Usage: eib install [package] --target <path> [--apply]

Install is a dry-run by default. --apply writes only the reviewed plan.
The package defaults to .eib/package.json.`,
  approve: `Usage: eib approve [package] --statement <text> [--output <directory>]

Record an explicit human approval against the exact current package revision.
The package defaults to .eib/package.json.`,
  preferences: `Usage: eib preferences show|set|unset [options]

Options:
  --default-target <id>  Set the default compilation target for future eib new commands
  --json                 Emit one machine-readable JSON document`,
  doctor: `Usage: eib doctor [--json]

Inspect local compiler backends without reading or storing credentials.`,
  knowledge: `Usage: eib knowledge check|stage [options]

Options:
  --source <id>           Limit source checks; repeat as needed
  --output <path>         Write the staged review artifact
  --json                  Emit one machine-readable JSON document`,
};

export function renderHelp(topic?: string): string {
  if (topic !== undefined && commandHelp[topic] !== undefined) {
    return commandHelp[topic];
  }
  return `Explain It Better — verified intent-to-agent compiler

Usage:
  eib                              Open the interactive terminal UI
  eib new [brief] [options]        Create an intent contract and package
  eib improve <package>            Improve from feedback and regression evidence
  eib optimize [package]           Generate candidates and gate a tested promotion
  eib compile [package] --target   Compile exact model/surface artifacts
  eib eval [package]               Evaluate statically or with explicit consent
  eib export [package]             Export a portable package
  eib install [package]            Preview or apply a reviewed installation
  eib approve [package]            Record an auditable human approval
  eib preferences show|set|unset   Manage credential-free CLI defaults
  eib doctor                       Inspect safe local backend readiness
  eib knowledge check|stage        Review official-source drift

Global options:
  --json                           Machine-readable output (non-interactive only)
  -h, --help                       Show help
  --version                        Show version

Run "eib <command> --help" for command details.`;
}

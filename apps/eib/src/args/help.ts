const commandHelp: Readonly<Record<string, string>> = {
  new: `Usage: eib new [brief] [options]

Turn a human demand into a target-aware prompt package.

Options:
  --brief <text>          Brief (alternative to positional text)
  --target <id>           Compile a target; repeat for multiple targets
  --schema <JSON object>  Structured output schema
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

Generate one to three demand-preserving prompt candidates and a held-out evaluation plan.
With a named --backend and explicit consent, run every candidate on the same held-out suite.
With --runs, make a fail-closed promotion recommendation from imported evidence.
The source package and its verification status are never changed.

Options:
  --max-candidates 1|2|3     Candidate count (default: 3)
  --target <id>              Exact target to test; required when the package has several
  --backend codex|claude|openai  Explicit candidate executor; never inferred
  --allow-execution          Required consent before any candidate model call
  --depth quick|default|deep Repetitions for an executed candidate run
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
  --depth quick|default|deep  Repetitions for proxy/live model evaluation
  --backend codex|claude|openai  Required evaluator; live mode requires openai
  --fixtures <json-file>  Static outputs keyed by every evaluation case ID
  --allow-execution       Explicit consent required before any model run
  --json                  Emit one machine-readable JSON document`,
  export: `Usage: eib export [package] --format directory|clipboard [options]

Options:
  --output <directory>    Required for directory export
  --json                  Emit one machine-readable JSON document`,
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
  return `Explain It Better — demand-to-best-tested-prompt optimizer

Usage:
  eib                              Open the interactive terminal UI
  eib new [demand] [options]       Turn a demand into a prompt package
  eib improve <package>            Revise a prompt from feedback
  eib optimize [package]           Compare candidates and gate a best-tested prompt
  eib compile [package] --target   Adapt the prompt for an exact model/surface
  eib eval [package]               Validate a prompt statically or with consent
  eib export [package]             Export a paste-ready prompt package
  eib preferences show|set|unset   Manage credential-free CLI defaults
  eib doctor                       Inspect local evaluator readiness
  eib knowledge check|stage        Review official-source drift

Global options:
  --json                           Machine-readable output (non-interactive only)
  -h, --help                       Show help
  --version                        Show version

Run "eib <command> --help" for command details.`;
}

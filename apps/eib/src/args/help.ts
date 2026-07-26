const commandHelp: Readonly<Record<string, string>> = {
  install: `Usage: eib install [--update] [--json]

Install project-local EIB runtime assets. It creates only EIB-owned config,
Codex skill, and Claude Code slash-command files; existing user instructions
are never overwritten. Use --update to refresh only EIB-owned assets whose
versioned fingerprint confirms they have not been edited locally.`,
  transform: `Usage: eib transform [request] [options]

Compile a natural request into a runtime-aware agent brief. The normal mode
uses scoped visible context; --deep scans safe tracked repository text files.

Options:
  --runtime auto       Detect the active agent runtime (default)
  --for <target>       Export for another reviewed target profile
  --deep               Explicit full tracked-repository context scan
  --brief <text>       Request (alternative to positional text)
  --json               Emit the complete preview as one JSON document`,
  confirm: `Usage: eib confirm <run-token> [--json]

Confirm a transformed brief and return the exact handoff instructions for the
active agent.`,
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
  --fixtures <json-file>  Static outputs keyed by every evaluation case ID (required for proxy/live)
  --allow-execution       Explicit consent required before any model run
  --json                  Emit one machine-readable JSON document`,
  prove: `Usage: eib prove [package] --fixtures <json-file> --output <relative-receipt.json> [--json]

Create a deterministic local reproducibility receipt. It validates complete
fixture evidence and confirms the current compiler reproduces every stored
artifact byte-for-byte. It never calls a model or proves an installed host.

Options:
  --fixtures <json-file>  Output fixtures keyed by every evaluation case
  --output <path>         New workspace-relative receipt path; never overwritten
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
  knowledge: `Usage: eib knowledge check|stage|refresh|promote-plan [options]

Options:
  --source <id>           Limit source checks; repeat as needed
  --output <path>         Write the non-active review/proposal artifact
  --from <refresh.json>   Read discovery evidence for promote-plan only
  --json                  Emit one machine-readable JSON document`,
};

export function renderHelp(topic?: string): string {
  if (topic !== undefined && commandHelp[topic] !== undefined) {
    return commandHelp[topic];
  }
  return `Explain It Better — demand-to-best-tested-prompt optimizer

Usage:
  eib                              Open the interactive terminal UI
  eib install                      Install project-local runtime assets
  eib transform [request]          Compile a runtime-aware agent brief
  eib confirm <run-token>          Confirm a preview and receive its handoff
  eib new [demand] [options]       Turn a demand into a prompt package
  eib improve <package>            Revise a prompt from feedback
  eib optimize [package]           Compare candidates and gate a best-tested prompt
  eib compile [package] --target   Adapt the prompt for an exact model/surface
  eib eval [package]               Validate a prompt statically or with consent
  eib prove [package]              Emit a local reproducibility receipt for CI
  eib export [package]             Export a paste-ready prompt package
  eib preferences show|set|unset   Manage credential-free CLI defaults
  eib doctor                       Inspect local evaluator readiness
  eib knowledge check|stage|refresh|promote-plan Review official-source drift and promotion plans

Global options:
  --json                           Machine-readable output (non-interactive only)
  -h, --help                       Show help
  --version                        Show version

Run "eib <command> --help" for command details.`;
}

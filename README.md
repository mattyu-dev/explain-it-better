# Explain It Better

Explain It Better (`eib`) v0.1 is a local, terminal-first, profile-aware
deterministic intent-to-agent compiler. It turns an underspecified human
request into a versioned agent package using reviewed target profiles and
deterministic renderers; it does not generate or optimize prompts with a model
during compilation.

```text
brief → adaptive clarification → frozen intent contract → agent blueprint
      → target compilation → compatibility/security lint → evaluation
      → export or reviewed installation
```

The compiler exposes a strict candidate-promotion gate through `eib optimize`.
A candidate may be labeled "best tested" only when supplied results use
identical held-out cases, show a measurable improvement, and contain no
critical regression. Compiled, static, or proxy evidence is never presented as
target-model proof; the product makes no claim of universal prompt perfection.

The reviewed knowledge pack covers OpenAI, Anthropic, Gemini, xAI, DeepSeek, Meta
Llama, Mistral, and Kimi/Moonshot. Cohere is intentionally and completely
excluded.

## Quick start

Requirements are Node.js 22+ and npm 10+.

```bash
npm install
npm run build
node apps/eib/dist/cli.js
```

Create the included decision-memo package, validate deterministic fixture
outputs, then (optionally) ask an isolated local evaluator for proxy evidence:

```bash
node apps/eib/dist/cli.js new \
  --brief "Write a sourced decision memo for an engineering leader" \
  --target openai-gpt-5.6-api \
  --fast \
  --output .eib/packages/research-memo

node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode static \
  --fixtures examples/sourced-decision-memo/static-fixtures.json

# Optional: this runs an authenticated local Codex or Claude CLI and records
# proxy evidence. It is not execution by the target model.
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode proxy \
  --backend codex \
  --allow-execution
```

`--fast` accepts every recommended assumption and records it in the
clarification lineage. Without it, `new` returns the single highest-information
question with deterministic exit code `3`. To earn the
`statically_validated` label, pass `--fixtures <json-file>` to `eval`; the file
must map every generated evaluation-case ID to its deterministic output.

The exact runnable fixture is in
[`examples/sourced-decision-memo`](examples/sourced-decision-memo/README.md).
Run `node examples/sourced-decision-memo/verify.mjs` to check that its fixture
still covers every static evaluation case before using it. Static validation
only proves the supplied outputs pass deterministic checks; proxy evaluation
adds evaluator evidence, while native target-model execution remains unavailable.

## Commands

```text
eib
eib new [brief] [--target <id>] [--fast] [--output <directory>]
        [--schema '<JSON object>'] [--tools '<JSON array>']
        [--mcp-servers '<JSON array>']
eib improve <package> --feedback <correction> [--output <directory>]
eib optimize [package] [--max-candidates 1|2|3] [--runs <json-file>]
             [--comparisons <json-file>] [--minimum-improvement <n>]
eib compile [package] --target <id> [--output <directory>]
eib eval [package] --mode static|proxy|live [--fixtures <json-file>]
         [--depth quick|default|deep]
         [--backend codex|claude --allow-execution]
eib export [package] --format clipboard|directory [--output <directory>]
eib install [package] --target <absolute-path> [--apply]
eib approve [package] --statement <text> [--output <directory>]
eib preferences show|set|unset [--default-target <id>]
eib doctor
eib knowledge check|stage
```

Every non-interactive command supports `--json`. Exit codes are stable:
`0` success, `1` command failure, `2` usage error, `3` clarification required,
`69` backend unavailable, and `130` cancellation.

External evaluation depths run one, three, and five repetitions respectively.
Proxy evaluation requires `--backend codex|claude` and `--allow-execution`; it sends
the compiled package and its cases to an isolated authenticated local CLI for
judgment. It is proxy evidence, not target execution or target-model evidence.
`--mode live` is reserved for a future native target executor and currently
fails closed with exit code `69`. Static validation checks package structure,
compatibility, and supplied deterministic output fixtures. Without fixtures it
is reported as structure-only validation and does not advance verification.

`eib optimize` produces an intent-preserving candidate set and held-out plan.
When complete evaluation runs are supplied, it emits a promotion recommendation
only when the result clears the strict gate; it never changes a package or its
verification label. `eib approve` records a statement against the exact current
package revision and advances a valid package to `human_approved`. Preferences
store only a credential-free default target in the operating system's standard
application-data location.

## Target profiles

Current built-in targets include:

- OpenAI GPT-5.6 API, ChatGPT, and Codex
- Anthropic Claude Sonnet 5 API, Claude, and Claude Code
- Gemini 3.1 Pro API
- xAI Grok 4.5 API
- DeepSeek Chat and Reasoner APIs
- Meta Llama 4 Maverick open weights
- Mistral Large 3 hosted and open weights
- Kimi K3, K2.7 Code, and K2.6 hosted APIs
- Separate conservative self-hosted profiles for each Kimi model
- Kimi Code and Hermes export targets

Provider, exact model, endpoint, deployment host, and user surface are modeled
separately. OpenAI-compatible transport never grants OpenAI capabilities by
inheritance. Run `eib` to browse exact profile IDs in the target selector.

## Package contents

Portable packages are written under `.eib/packages/` by default and contain:

- the original brief and complete clarification lineage;
- `blueprint.json` with roles, typed inputs, workflow, subagents, tools,
  memory, permissions, approvals, budgets, verification, and stopping rules;
- target-specific prompts or request/deployment manifests;
- tool, input, output, and approval schemas;
- ten required evaluation categories in `evals.jsonl`;
- source hashes, applied knowledge-rule IDs, and a verification report.

MCP server declarations may be supplied to `eib new` with `--mcp-servers` as a
JSON array and are written unchanged to `mcp-servers.json`. This is a
declarative allowlist, not a runtime integration: EIB never starts a server,
contacts an endpoint, or stores credentials. HTTP declarations require HTTPS
and cannot embed credentials; stdio declarations are executable names rather
than shell commands. A target runtime must separately bind and approve them.

Project history uses only Markdown, JSON, and JSONL. `eib preferences` stores
the credential-free default target in the platform-standard application-data
location; reviewed documentation caches remain opt-in and are never populated
automatically.
Credentials are never stored.

## Knowledge lifecycle

The knowledge pack contains reviewed, small rules backed by official sources.
Every rule records source URL, date, hash, confidence, conflicts, and an
executable conformance expectation.

`eib knowledge check` applies each source's reviewed drift strategy and reports
hash equality separately from required-signal checks. `eib knowledge stage`
writes a non-active review artifact; changed rules never become active
automatically.

## Safety model

- User and retrieved material remain data and never become high-authority
  policy.
- Unsupported roles, tools, schemas, modalities, reasoning modes, state
  combinations, and context sizes fail closed.
- Raw open-weight control tokens never enter the provider-neutral blueprint.
- Codex runs ephemerally with user rules/config ignored, a read-only sandbox,
  no web, and schema-constrained output.
- Claude runs in print/safe mode with no Chrome, persistence, tools, or MCP.
- Hermes and Kimi remain target-only until a reviewed zero-tool isolation
  conformance test succeeds.
- Generated agents are exported or installed; they are never launched.
- Installation is a dry run unless `--apply` is supplied, rejects symlink/path
  escapes, backs up managed updates, and never overwrites unowned or edited
  files.
- Verification advances through `compiled`, `statically_validated`,
  `proxy_evaluated`, `target_evaluated`, and `human_approved`. A failed rerun
  that replaces prior evidence invalidates the affected label instead of
  preserving a stale claim.

Prompt hardening and delimiters are not treated as security boundaries.

## Architecture and development

The npm workspace contains:

- `apps/eib`: Ink 7 / React 19.2 TUI and scriptable CLI
- `packages/core`: contracts, intent engine, compiler, evaluation, package
  export, and guarded installer
- `packages/knowledge`: source manifests, profiles, reviewed rules, drift
  detection, and conformance tests

Run the complete release gate:

```bash
npm run release:check
```

The core compiler, schemas, adapters, knowledge-pack format, and TUI are
licensed under Apache-2.0.

## Project operations

This is a private source repository. Its workspaces are intentionally marked
`private`, so `npm publish` fails closed. The release gate verifies build,
types, lint, coverage, package contents, and high-severity dependency audit;
it validates packages with `npm pack --dry-run` but does not publish them.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow,
[CHANGELOG.md](CHANGELOG.md) for release history, and [RELEASE.md](RELEASE.md)
for the private-repository release procedure.

# Explain It Better

Explain It Better is a portable, confirmation-gated Agent Skill. It turns a
rough request into an agreed brief before work starts, then lets the same agent
perform the confirmed task. The core Skill works without a shell, plugin tool,
repository, network connection, or host-specific API.

```text
rough request → visible brief → explicit confirmation → same-conversation handoff
```

The optional **Power mode** adds the local `eib` CLI, target-aware rendering,
safe project-context selection, reproducible packages, evaluation, and a local
stdio MCP server. It is an enhancement, never a requirement for the core Skill.

Power mode's reviewed knowledge pack covers OpenAI, Anthropic, Gemini, xAI,
DeepSeek, Meta Llama, Mistral, and Kimi/Moonshot. Cohere is intentionally
excluded.

## Install the Skill

Use the canonical bundle at
[`skills/explain-it-better`](skills/explain-it-better). It is the source for
the Codex plugin and the Claude Code plugin:

```text
Codex plugin: plugins/explain-it-better
Claude Code:  claude-plugin/explain-it-better
```

Each bundle is self-contained and follows the same contract: clarify only
material unknowns, show assumptions, wait for confirmation, then proceed. Do
not claim a host supports local repository analysis unless that host actually
provides it.

Install from the public marketplaces—no clone or shell is required for the
core Skill:

```bash
# Codex CLI
codex plugin marketplace add mattyu-dev/explain-it-better
codex plugin add explain-it-better@explain-it-better

# Claude Code
claude plugin marketplace add mattyu-dev/explain-it-better
claude plugin install explain-it-better@explain-it-better
```

Verified hosts are Codex CLI and Claude Code. ChatGPT and Claude desktop/web
surfaces may support Skill or plugin import, but availability and installation
routes depend on the account, workspace policy, plan, and current client UI;
they are not validated by these marketplace commands.

Update marketplace installations with:

```bash
codex plugin marketplace upgrade explain-it-better
claude plugin marketplace update explain-it-better
claude plugin update explain-it-better@explain-it-better
```

Start a new conversation after installation so the host can discover the
Skill. For development or offline testing, add the checkout itself as the
marketplace source (`codex plugin marketplace add .` or
`claude plugin marketplace add .`).

## Power mode: local project integration

Requirements are Node.js 22+ and npm 10+.

```bash
npm install
npm run build
npm link --workspace @eib/cli
```

`npm link` makes the `eib` and `eib-mcp` commands available in your interactive
shell. Install EIB-owned local assets in a project:

```bash
eib install
```

This writes the portable Skill to `.agents/skills`, `.codex/skills`, and
`.claude/skills`, plus `/eib` and `/eib-deep` commands for **Claude Code**.
Other hosts receive the portable confirmation-gated Skill, not a CLI-backed
slash command. It never overwrites `AGENTS.md`, `CLAUDE.md`, or another
user-owned instruction file.

### Compatibility

| Surface | Core Skill | Power mode |
| --- | --- | --- |
| Codex CLI marketplace | Verified | No local project access implied |
| Claude Code marketplace | Verified | Optional CLI commands |
| ChatGPT or Claude desktop/web import | Account- and UI-dependent | No local project access implied |
| Local MCP host (manual configuration) | Not required | `eib-mcp` stdio server |

After upgrading EIB, run `eib install --update`. Every generated host asset is
versioned and fingerprinted; EIB refreshes only assets whose fingerprint shows
they were not edited locally, and reports modified assets it safely preserves.

For deterministic, target-aware local preparation, transform a natural request:

```bash
eib transform "review the architecture and tell me what to update" --runtime auto
```

EIB detects a supported active runtime, resolves its reviewed target profile,
selects visible project context, and returns a preview plus a run token. It
does not start work at this point. EIB requires exact runtime model metadata
before applying target-specific rules; if the host does not expose it, select
a reviewed `--for <target>` explicitly. After reviewing the target, context
manifest, and assumptions:

```bash
eib confirm <run-token>
```

`confirm` returns the exact handoff brief for the active agent. In Claude Code,
use `/eib "request"`; use `/eib-deep "complex request"` only when an explicit
full tracked-repository scan is appropriate. The portable Skill on other hosts
uses its same-conversation confirmation flow. The CLI equivalent is
`eib transform --deep …`.

### Local MCP

`eib-mcp` is a local stdio server, not a hosted remote service. Configure it in
an MCP-capable host with command `eib-mcp` and a working directory set to the
project it may inspect. Its workspace is fixed at launch: clients cannot supply
or redirect a workspace through tool arguments. The server returns preparation
and acknowledgement handoffs only; the host remains responsible for collecting
the user's explicit approval before it calls `eib_confirm`.

Scoped mode records metadata for project instructions, manifests, and
request-relevant files; Power mode does not copy their raw text into a host
response or runtime record. Deep mode scans tracked readable text files and
records every included or skipped path. Both reject ignored/generated
directories, binary files, secret-named paths, and conservative detected
credential content. If the runtime cannot be identified exactly, EIB asks for
`--for <target>` rather than pretending its prompt is target-specific.

Start with a demand and target. EIB parses the demand into visible fields such
as outcome, audience, deliverable, constraints, inputs, exclusions, success
criteria, and output contract. It asks only when a material field cannot be
resolved safely; `--fast` accepts its visible assumptions for a quick first
prompt:

```bash
node apps/eib/dist/cli.js new \
  --brief "Write a sourced decision memo for an engineering leader" \
  --target openai-gpt-5.6-api \
  --fast \
  --output .eib/packages/research-memo

node apps/eib/dist/cli.js export .eib/packages/research-memo \
  --format clipboard
```

`--fast` records the recommended assumptions in the clarification lineage.
Without it, `new` asks the single highest-information question and returns
exit code `3`, so the demand stays human-controlled rather than silently
guessed.

To optimize with imported results, generate the target-aware candidate plan and
evaluate every candidate on the same demand-specific held-out cases:

```bash
node apps/eib/dist/cli.js optimize .eib/packages/research-memo \
  --max-candidates 3 \
  --runs results.json \
  --comparisons comparisons.json
```

Or authorize a reproducible candidate run directly. This example makes paid
OpenAI Responses API calls; see [Executed candidate evidence](#executed-candidate-evidence)
before running it:

```bash
node apps/eib/dist/cli.js optimize .eib/packages/research-memo \
  --target openai-gpt-5.6-api \
  --backend openai \
  --allow-execution \
  --depth quick \
  --output evidence.json
```

The runnable walkthrough in
[`examples/sourced-decision-memo`](examples/sourced-decision-memo/README.md)
shows the full flow, including deterministic validation and the limits of
proxy evidence.

## Power-mode optimizer loop

1. **Structure the demand.** EIB extracts the requested outcome, audience,
   deliverables, source inputs, hard constraints, exclusions, success criteria,
   and output contract. It retains the original wording and makes any
   assumption or unresolved ambiguity visible.
2. **Create a target-aware baseline.** EIB applies reviewed knowledge for the
   exact provider, model, endpoint, and surface selected.
3. **Explore distinct prompt strategies.** `eib optimize` creates a baseline
   plus intent-preserving variants whose structure and target-specific
   guidance differ in documented ways. It never silently rewrites the frozen
   demand.
4. **Build and run a demand-specific held-out suite.** Cases and rubrics are
   derived from the demand's deliverable, constraints, risks, and success
   criteria. Every candidate is evaluated on the identical case/repetition
   keys, so results are comparable.
5. **Promote only from bound evidence.** A winner requires complete evidence
   for the generated candidates, the selected target, exact candidate hashes,
   and the declared held-out suite—plus measurable improvement and no critical
   regression. A recommendation never overwrites the source package.
6. **Export the winning prompt.** Use `eib export --format clipboard` for a
   paste-ready result or `--format directory` for the reproducible evidence
   bundle.

The resulting bundle is useful evidence, not an application to deploy. It
contains the original demand, clarification lineage, rendered prompt,
evaluation cases, scores, provenance, and verification report.

## CLI reference

The built CLI is the command reference; it is validated in the release gate.
Run `eib --help`, then `eib <command> --help`, for the exact syntax supported
by the installed version. The command groups are: project integration
(`install`, `transform`, `confirm`); prompt packages (`new`, `improve`,
`compile`, `export`); evidence (`optimize`, `eval`, `prove`); local readiness
(`preferences`, `doctor`); and reviewed knowledge (`knowledge`).

Every non-interactive command supports `--json`. Exit codes are stable: `0`
success, `1` command failure, `2` usage error, `3` clarification required,
`69` backend unavailable, and `130` cancellation.

`eib improve` incorporates explicit human feedback into a new prompt bundle;
it never rewrites the previous version in place. `eib compile` renders the
same frozen demand for another target. `eib export` is the final hand-off:
clipboard output is for immediate use, while directory output keeps the
evidence needed to reproduce the result.

## Evaluation evidence

`eib eval --mode static` checks the bundle, compatibility, and supplied
deterministic fixtures. It establishes that those checks pass, not that a
model response is high quality. Static evidence can support package integrity,
but cannot by itself promote a prompt.

### Local reproducibility proof

`eib prove` turns complete static fixture evidence into a tamper-evident,
workspace-local receipt for CI. It re-renders every stored target artifact and
fails if even one byte, filename, MIME type, fixture check, or deterministic
package assertion differs. The receipt stores hashes rather than raw prompt or
fixture-output text, never changes the source package, and is created once at
a new relative path with restrictive file permissions:

```bash
node apps/eib/dist/cli.js prove .eib/packages/research-memo \
  --fixtures static-fixtures.json \
  --output .eib/proofs/research-memo.json
```

This proves **local reproducibility only**. It does not call a model, inspect
an installed Codex/Claude/desktop integration, test tools or side effects, or
guarantee behavior after a provider update. A failed but complete run still
writes its receipt and exits `1`, so CI retains the evidence while blocking the
change. Incomplete or malformed evidence fails closed without a green receipt.

`eib eval --mode proxy` can ask an authenticated local Codex or Claude CLI to
judge cases when `--allow-execution` is explicit. This is independent evaluator
evidence, not execution by the selected target model.

Before any proxy or live evaluation, static validation must have produced
**complete passing evidence for every evaluation-case/compiled-target pair**.
Run it with fixtures and persist the resulting package first:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode static \
  --fixtures static-fixtures.json
```

For supported OpenAI Responses API targets, native evaluation is then explicit:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode live \
  --backend openai \
  --allow-execution \
  --depth quick
```

Live evaluation executes the target prompt and separately asks the same target
for a schema-constrained judgment. A complete passing live run advances the
package to `target_evaluated`; failed, unsupported, or incomplete runs do not.
It requires a non-empty `OPENAI_API_KEY` in the invoking environment and a
reviewed OpenAI target that uses the Responses API and that the account may
call. Tools are disabled and responses are not stored. Missing credentials,
unsupported profiles, or incomplete static evidence fail closed.

## Executed candidate evidence

`eib optimize` has two evidence paths. Imported `--runs` (and optional blinded
`--comparisons`) keeps model execution outside EIB. Alternatively, a named
`--backend` plus `--allow-execution` runs every candidate against the same
held-out suite. The flags are mutually exclusive: EIB never silently combines
unverifiable imported runs with a live execution.

- `--backend codex` and `--backend claude` use the selected local CLI as a
  **proxy judge**. Their evidence is useful for comparison but is not proof of
  the named target model's performance.
- `--backend openai` uses the OpenAI Responses API for an OpenAI target. It
  requires an explicit, non-empty `OPENAI_API_KEY` in the invoking environment
  and a target model your account is authorized to call. The key is not stored
  in the package or preferences. Requests disable tools and response storage.
  Unsupported targets or missing credentials fail closed.

Execution may incur model charges. EIB runs candidates sequentially, once for
each candidate × held-out case × repetition: `quick` is 1 repetition,
`default` is 3, and `deep` is 5. Start with `quick`, inspect the generated
suite and target model, and choose `--max-candidates` and `--depth` knowingly.
Native `eval --mode live` makes two OpenAI Responses requests per compiled
target × case × repetition (one target response and one structured judge), so
it has a distinct cost multiplier. Check your model's current pricing and
account limits before authorizing either path.
The recorded backend, model, timing, prompt hash, case, repetition, and
observable evidence make the resulting comparison auditable—but they do not
turn it into a universal or permanent quality claim.

Native target execution is therefore optional, explicitly authorized, and
limited to the target, exact prompt, and suite recorded in its evidence. It is
not a guarantee for another model, future version, or task.

The verification report distinguishes `compiled`, `statically_validated`,
`proxy_evaluated`, and `target_evaluated`; a rerun that replaces evidence also
invalidates the affected earlier claim. Promotion evidence records the frozen
demand, target, case-suite identity, candidate prompt hashes, scores, and
provenance. Only the promotion gate may call a candidate **best tested**, and
only with complete comparable results.

## Target profiles and knowledge

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

Provider, exact model, endpoint, and user surface are modeled separately so a
prompt is adapted to where it will actually be used. Run `eib` to browse exact
profile IDs in the target selector.

Knowledge rules are small, source-traceable, and reviewed. Each records its
source URL, date, hash, confidence, conflicts, and executable conformance
expectation. `eib knowledge check` reports source drift; `eib knowledge stage`
writes a hash-review artifact; and `eib knowledge refresh` combines drift
checks with an official provider catalog/release scan. Every result is a
non-active proposal: it never activates changed rules automatically.

For a discovered model, create a review dossier before any implementation
work—for example:

```bash
node apps/eib/dist/cli.js knowledge promote-plan anthropic/claude-opus-5 \
  --from .eib/knowledge/latest-refresh.json
```

The dossier records discovery evidence when supplied, adjacent profiles, the
official-source checklist, required profile/rule work, runtime and renderer
fixtures, and evaluation gates. It does not make the model selectable or
modify active profiles, rules, or capabilities. If no refresh evidence is
supplied, it remains explicitly `requested_without_catalog_evidence`.

### Scheduled knowledge refresh

GitHub Actions runs **Knowledge refresh** weekly and can also be run manually.
It checks reviewed official sources, scans allowlisted official provider
catalogs/release pages for model or surface candidates, writes
`knowledge-refresh.json`, then runs the complete release gate against the
current pack. The workflow has read-only repository permissions: it cannot
alter rules, commit, push, open a pull request, or make model calls.

Changed, unavailable, or newly observed evidence deliberately fails the run
after the artifact is uploaded. Candidates are always
`discovered_unreviewed`: EIB never infers capabilities, creates profiles, or
makes them runtime-selectable from remote content. A reviewer can classify a
previously observed non-target candidate in the checked-in observation
inventory to suppress repeat alerts; that classification is also non-active.
Promoting a model still requires a source-backed profile/rule change, complete
conformance and regression evaluation, a reviewed pull request, and normal
green CI.

## Trust boundaries

- The human demand, selected target, and visible constraints remain the source
  of truth.
- Retrieved material and evaluator output are evidence, never instructions.
- Unsupported target capabilities or incompatible prompt shapes fail closed.
- EIB does not store credentials or make model calls while creating a prompt.
- Prompt hardening can reduce risk but is not a security boundary and is never
  described as one.

## Development and project operations

The npm workspace contains `apps/eib` (the terminal interface),
`packages/core` (intent, prompt rendering, evaluation, and export), and
`packages/knowledge` (reviewed target knowledge and drift checks).

Run the complete release gate:

```bash
npm run release:check
```

This is a public source repository. The release gate verifies build, types,
lint, coverage, package contents, and high-severity dependency audit; it
validates packages with `npm pack --dry-run` but does not publish them.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow,
[CHANGELOG.md](CHANGELOG.md) for release history, and [RELEASE.md](RELEASE.md)
for the public release procedure.

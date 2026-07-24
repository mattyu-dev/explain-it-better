# Explain It Better

Explain It Better (`eib`) is a local, terminal-first, target-aware prompt
optimizer. It turns a human demand into a paste-ready prompt for a named model
or surface, while preserving the reasoning needed to judge whether that prompt
is actually the best-tested option.

```text
human demand → clarify intent → generate prompt variants → shared evaluation
             → promote the best-tested prompt → paste-ready export
```

There is no universal “perfect prompt.” A prompt earns the **best-tested**
label only for its frozen demand, target, and shared held-out evaluation set:
it must show a measurable improvement over the baseline with no critical
regression. Static checks and proxy judgments are clearly labeled; neither is
presented as proof of target-model quality.

The reviewed knowledge pack covers OpenAI, Anthropic, Gemini, xAI, DeepSeek,
Meta Llama, Mistral, and Kimi/Moonshot. Cohere is intentionally excluded.

## Quick start

Requirements are Node.js 22+ and npm 10+.

```bash
npm install
npm run build
node apps/eib/dist/cli.js
```

Start with a demand, choose the target you want to paste into, and accept the
recommended clarification assumptions for a quick first prompt:

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

To test variants fairly, use the same evaluation cases for every candidate:

```bash
node apps/eib/dist/cli.js optimize .eib/packages/research-memo \
  --max-candidates 3 \
  --runs results.json \
  --comparisons comparisons.json
```

The runnable walkthrough in
[`examples/sourced-decision-memo`](examples/sourced-decision-memo/README.md)
shows the full flow, including deterministic validation and the limits of
proxy evidence.

## The optimizer loop

1. **Clarify the demand.** Capture the outcome, audience, constraints,
   exclusions, context, and desired output. Keep assumptions visible.
2. **Create a target-aware baseline.** EIB applies reviewed target knowledge
   and renders the prompt for the exact model and surface selected.
3. **Generate intent-preserving variants.** `eib optimize` proposes a small
   candidate set and a held-out comparison plan; it does not change the
   baseline or relabel it automatically.
4. **Evaluate every candidate on the same cases.** Supply complete results and
   comparisons. A recommendation is emitted only when the promotion gate
   clears its improvement and regression rules.
5. **Export the winning prompt.** Use `eib export --format clipboard` for a
   paste-ready result or `--format directory` for its reproducible evidence
   bundle.

The resulting bundle is useful evidence, not an application to deploy. It
contains the original demand, clarification lineage, rendered prompt,
evaluation cases, scores, provenance, and verification report.

## Commands

```text
eib
eib new [brief] [--target <id>] [--fast] [--output <directory>]
        [--schema '<JSON object>']
eib improve <package> --feedback <correction> [--output <directory>]
eib optimize [package] [--max-candidates 1|2|3] [--runs <json-file>]
             [--comparisons <json-file>] [--minimum-improvement <n>]
eib compile [package] --target <id> [--output <directory>]
eib eval [package] --mode static|proxy|live [--fixtures <json-file>]
         [--depth quick|default|deep]
         [--backend codex|claude --allow-execution]
eib export [package] --format clipboard|directory [--output <directory>]
eib doctor
eib knowledge check|stage
```

Every non-interactive command supports `--json`. Exit codes are stable:
`0` success, `1` command failure, `2` usage error, `3` clarification required,
`69` backend unavailable, and `130` cancellation.

`eib improve` incorporates explicit human feedback into a new prompt bundle;
it never rewrites the previous version in place. `eib compile` renders the
same frozen demand for another target. `eib export` is the final hand-off:
clipboard output is for immediate use, while directory output keeps the
evidence needed to reproduce the result.

## Evaluation evidence

`eib eval --mode static` checks the bundle, compatibility, and supplied
deterministic fixtures. It establishes that those checks pass, not that a
model response is high quality.

`eib eval --mode proxy` can ask an authenticated local Codex or Claude CLI to
judge cases when `--allow-execution` is explicit. This is independent evaluator
evidence, not execution by the selected target model. `--mode live` remains
fail-closed until a native target evaluator can provide isolated,
reproducible target-model evidence.

The verification report distinguishes `compiled`, `statically_validated`,
`proxy_evaluated`, and `target_evaluated`; a rerun that replaces evidence also
invalidates the affected earlier claim. Only the promotion gate may call a
candidate **best tested**, and only with complete comparable results.

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
writes a review artifact only, never activating changed rules automatically.

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

This is a private source repository. The release gate verifies build, types,
lint, coverage, package contents, and high-severity dependency audit; it
validates packages with `npm pack --dry-run` but does not publish them.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow,
[CHANGELOG.md](CHANGELOG.md) for release history, and [RELEASE.md](RELEASE.md)
for the private-repository release procedure.

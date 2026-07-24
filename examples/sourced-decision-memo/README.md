# Sourced decision memo: prompt-optimizer walkthrough

This directory contains a reproducible prompt bundle produced by `eib new` for
one deliberately modest demand: write a sourced decision memo for an
engineering leader. It demonstrates the optimizer workflow, not an agent that
acts on a user's behalf. Its checked-in artifact is not evidence that the
named OpenAI model has run it.

EIB keeps the original brief and a structured demand interpretation together:
the requested outcome, audience, deliverable, constraints, evidence policy,
success criteria, and output contract all remain reviewable. The optimization
claim is deliberately narrow: a prompt can be best-tested only for this frozen
demand, selected target, and exact held-out suite.

From the repository root, install and build the CLI once:

```bash
npm install
npm run build
```

## 1. Turn the demand into a target-aware baseline prompt

The prompt and evaluation-case IDs are deterministic for this exact demand,
target, and `--fast` clarification path. Write the result outside the checked
in fixture so the original demand and every assumption remain inspectable:

```bash
node apps/eib/dist/cli.js new \
  --brief "Write a sourced decision memo for an engineering leader" \
  --target openai-gpt-5.6-api \
  --fast \
  --output .eib/packages/research-memo
```

The bundle includes the frozen structured intent, paste-ready target prompt,
demand-specific evaluation cases and rubrics, provenance, and an initial
`compiled` verification report. Read the saved intent before optimizing: any
assumption or unresolved ambiguity should be corrected with `eib improve`
rather than hidden in a new candidate.

## 2. Check the shared evaluation fixtures

First confirm this fixture covers every generated case:

```bash
node examples/sourced-decision-memo/verify.mjs .eib/packages/research-memo
```

Then validate the supplied deterministic outputs:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode static \
  --fixtures examples/sourced-decision-memo/static-fixtures.json
```

This records `statically_validated` evidence. The fixture outputs are
intentionally simple because every generated check here is `non_empty`; this
only proves the prompt bundle and explicit checks are valid. It is neither a
quality result nor target-model execution.

Complete passing static evidence for every case/target pair is required before
any proxy or live model evaluation. With an OpenAI Responses API target and an
authorized `OPENAI_API_KEY`, request native evidence explicitly:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode live \
  --backend openai \
  --allow-execution \
  --depth quick
```

The live path runs the target prompt and a separate schema-constrained judge.
It makes two paid OpenAI Responses requests per target × case × repetition
(`quick` 1, `default` 3, `deep` 5), disables tools and response storage, and
fails closed for a missing key, incomplete static evidence, or a target that
is not a reviewed Responses API profile. A passing run can record
`target_evaluated`; it remains evidence only for the recorded target, prompt,
and suite.

You can independently validate the checked-in reference bundle:

```bash
node examples/sourced-decision-memo/verify.mjs
node apps/eib/dist/cli.js eval examples/sourced-decision-memo/package \
  --mode static \
  --fixtures examples/sourced-decision-memo/static-fixtures.json
```

## 3. Compare prompt candidates fairly

Ask EIB for a small target-aware, intent-preserving candidate set, then provide
results from the exact same demand-specific held-out cases for every candidate:

```bash
node apps/eib/dist/cli.js optimize .eib/packages/research-memo \
  --max-candidates 3 \
  --runs results.json \
  --comparisons comparisons.json
```

Alternatively, explicitly run the OpenAI-target candidates against the same
suite. This makes paid API calls and requires an authorized `OPENAI_API_KEY`:

```bash
node apps/eib/dist/cli.js optimize .eib/packages/research-memo \
  --target openai-gpt-5.6-api \
  --backend openai \
  --allow-execution \
  --depth quick \
  --output evidence.json
```

The promotion gate recommends a winner only when the comparison is complete,
measurably improves on the baseline, and has no critical regression. The run
records are bound to the source demand, target, candidate prompt hash, held-out
case ID, and repetition, so evidence cannot be reused for a changed prompt or
different target. That is what **best tested** means here; it does not mean
universally perfect.

## 4. Export the prompt for use

```bash
node apps/eib/dist/cli.js export .eib/packages/research-memo \
  --format clipboard
```

Use `--format directory` when you want the prompt and its evidence bundle
saved together for review or reproduction.

## Optional evaluator and native evidence

Run this only when you explicitly authorize an authenticated local evaluator:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode proxy \
  --backend codex \
  --allow-execution
```

Use `--backend claude` to select that evaluator. Proxy evidence is a judgment
from the evaluator, not proof that the OpenAI target model performs well.

For the optimization command, `--backend codex` and `--backend claude` are
proxy judges; `--backend openai` is the explicit OpenAI Responses route for an
OpenAI target. It requires `OPENAI_API_KEY` in the process environment, never
stores that key, disables tools and response storage, and fails closed if the
target is unsupported or the credential is absent. It can incur charges for
every candidate × case × repetition (`quick` 1, `default` 3, `deep` 5), so
start with `quick` and inspect the evidence file. Native evidence remains
limited to the recorded target, prompt hash, and suite; it does not establish
universal quality.

## Fixture contents

- `package/`: canonical prompt bundle emitted by the CLI.
- `static-fixtures.json`: one deterministic string output for every case ID.
- `verify.mjs`: a zero-dependency coverage check for this fixture and a bundle
  generated by the exact walkthrough above.

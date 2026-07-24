# Sourced decision memo: runnable package walkthrough

This directory contains a complete portable package produced by `eib new` for
one deliberately modest task: write a sourced decision memo for an engineering
leader. It is a reference fixture, not a claim that the package has been run by
the OpenAI model named in its artifact.

From the repository root, install and build the CLI once:

```bash
npm install
npm run build
```

## 1. Create the same package

The agent and evaluation case IDs are deterministic for this exact brief,
target, and `--fast` clarification path. Write it somewhere outside the checked
in fixture so you can inspect the complete lifecycle:

```bash
node apps/eib/dist/cli.js new \
  --brief "Write a sourced decision memo for an engineering leader" \
  --target openai-gpt-5.6-api \
  --fast \
  --output .eib/packages/research-memo
```

The resulting package includes the frozen intent, target request artifact,
evaluation cases, provenance, and its initial `compiled` verification report.

## 2. Verify and run deterministic static validation

First confirm this fixture exactly covers every generated case:

```bash
node examples/sourced-decision-memo/verify.mjs .eib/packages/research-memo
```

Then validate the supplied deterministic outputs:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode static \
  --fixtures examples/sourced-decision-memo/static-fixtures.json
```

This records `statically_validated` evidence on the new package. The fixture
outputs are intentionally simple because every generated check here is
`non_empty`; this step checks package structure and the explicit deterministic
checks only. It is not a quality judgment or model execution.

You can independently validate the checked-in reference package with the same
two commands:

```bash
node examples/sourced-decision-memo/verify.mjs
node apps/eib/dist/cli.js eval examples/sourced-decision-memo/package \
  --mode static \
  --fixtures examples/sourced-decision-memo/static-fixtures.json
```

## 3. Optionally collect proxy evaluation evidence

Only run this when you intend to authorize an authenticated local evaluator.
The `--allow-execution` flag is required deliberately:

```bash
node apps/eib/dist/cli.js eval .eib/packages/research-memo \
  --mode proxy \
  --backend codex \
  --allow-execution
```

Use `--backend claude` if that local CLI is the evaluator you intend to use.
Proxy evidence is evaluator evidence, not proof that the OpenAI target model
performs well. `--mode live` remains unavailable until a native target executor
passes its isolation conformance gate.

## Fixture contents

- `package/`: canonical portable package emitted by the CLI.
- `static-fixtures.json`: one deterministic string output for every case ID.
- `verify.mjs`: a zero-dependency coverage check for this fixture and any
  package generated from the exact walkthrough above.

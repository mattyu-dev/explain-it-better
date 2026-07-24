# Contributing to Explain It Better

## Prerequisites

- Node.js 22 or later
- npm 10.9.8 (the version pinned in `package.json`)

## Local workflow

1. Create a branch from current `main` using the `codex/` prefix when working
   with Codex.
2. Run `npm ci` to install the lockfile-resolved dependencies.
3. Make a focused change with tests in the owning workspace.
4. Run `npm run release:check` before requesting review.

The release check runs type checking, linting, coverage tests, the production
build, a dry-run package-content check, and `npm audit --audit-level=high`.
It does not publish packages.

## Change expectations

- Keep prompt creation deterministic; do not make model calls during
  compilation.
- Preserve the structured-demand contract. Original wording, extracted fields,
  visible assumptions, and unresolved ambiguities must remain reviewable; do
  not silently truncate or infer a material deliverable or output contract.
- Keep candidate strategies genuinely distinguishable while preserving the
  frozen demand. A variant must document what changed and why it is safe to
  compare with the baseline for the selected target.
- Treat evaluation as demand-specific. Held-out cases and rubrics must test the
  deliverable, constraints, risks, and success criteria of the demand—not only
  generic non-empty or safety checks.
- Bind promotion evidence to the frozen demand, target, candidate prompt hash,
  case-suite identity, and repetition. Do not weaken identical-coverage,
  regression, or provenance checks to make a candidate promotable.
- Preserve fail-closed behavior for unsupported provider capabilities and
  verification claims.
- Native target execution is opt-in, isolated, reproducible, and
  conformance-gated. It must require explicit `--allow-execution`, never store
  credentials, record its target/prompt/case/repetition provenance, and fail
  closed when the executor, target, credential, or complete passing static
  evidence is unavailable. Treat model cost as part of the execution boundary:
  document execution-count changes, including the target-plus-judge calls of
  native live evaluation.
- Add or update tests for behavioral changes. Do not lower coverage thresholds
  to make a change pass.
- Keep provider and knowledge-pack assertions traceable to reviewed source
  material. `eib knowledge stage` is review-only; it never activates changed
  rules automatically.
- Do not commit credentials, generated `.eib/` packages, `dist/`, coverage,
  or `node_modules/`.

## Pull requests

Describe the user-visible effect, verification performed, and any limitations.
For changes to demand parsing, target profiles, candidate generation,
evaluation, native execution, or security policy, include the affected
safety/verification boundary explicitly. State whether the change affects a
best-tested claim and add regression tests for that evidence contract. Require
a green CI run and at least one reviewer before merging to `main`.

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Follow
[SECURITY.md](SECURITY.md).

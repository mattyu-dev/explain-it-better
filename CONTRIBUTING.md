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
- Preserve fail-closed behavior for unsupported provider capabilities and
  verification claims.
- Add or update tests for behavioral changes. Do not lower coverage thresholds
  to make a change pass.
- Keep provider and knowledge-pack assertions traceable to reviewed source
  material. `eib knowledge stage` is review-only; it never activates changed
  rules automatically.
- Do not commit credentials, generated `.eib/` packages, `dist/`, coverage,
  or `node_modules/`.

## Pull requests

Describe the user-visible effect, verification performed, and any limitations.
For changes to target profiles, prompt rendering, evaluation, or security
policy, include the affected safety/verification boundary explicitly. Require
a green CI run and at least one reviewer before merging to `main`.

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Follow
[SECURITY.md](SECURITY.md).

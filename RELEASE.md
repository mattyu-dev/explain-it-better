# Private release process

This repository is private and v0.1 does not publish npm packages. A release is
a reviewed, versioned GitHub commit (and optionally a private GitHub Release),
not an `npm publish` operation. Every workspace has `private: true` as a guard.

## Before the first push

1. Create a **private** GitHub repository named `explain-it-better` with no
   generated README, license, or `.gitignore`.
2. Add it as `origin`, push `main`, then protect `main`: require a pull request,
   one approving review, and the `Release gate (Node 22)` status check.
3. Grant the minimum repository access needed by maintainers and CI. The
   workflow needs only read access to repository contents.

## Cut a release

1. Start from a clean, current `main` and create a release branch.
2. Update the root and all workspace versions together. Keep internal
   `@eib/*` dependency versions aligned with the release version.
3. Move relevant notes from `Unreleased` into a dated version heading in
   `CHANGELOG.md`.
4. Run `npm ci` followed by `npm run release:check` locally.
5. Review the public optimizer claims against the shipped behavior: structured
   demand preservation, target-aware variants, demand-specific held-out
   evaluation, evidence-bound promotion, and any native execution boundary.
6. Open a pull request. Merge only after the CI release gate and required
   review are green.
7. Tag the merged commit as `vX.Y.Z` and create a private GitHub Release whose
   notes match the changelog entry.

## After release

- Verify the tag resolves to the merged commit and the GitHub Release is
  private to repository members.
- Record any known limitations in the release notes. Do not describe proxy or
  static evaluation as target-model validation, and do not describe a
  best-tested prompt as universally perfect.
- If native target runs are included, record the supported target/executor,
  isolation conformance version, required explicit consent, and evidence scope.
  Do not imply that native evidence transfers to another prompt hash, model
  version, target surface, or held-out suite.
- For any release that changes executed candidate runs, verify the published
  `--backend` contract, explicit consent requirement, credential handling, and
  candidate × case × repetition cost multiplier. Do not label Codex or Claude
  proxy judging as native target execution.
- For native OpenAI live evaluation, verify the complete-static-evidence
  prerequisite, reviewed Responses-target gate, and the two-request
  target-plus-judge cost multiplier per target × case × repetition.
- Do not publish to npm. If public or registry distribution is ever approved,
  first change the package privacy policy, add provenance/registry controls,
  and review the release process separately.

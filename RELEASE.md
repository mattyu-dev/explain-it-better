# Distribution and release process

EIB has two distributable layers:

- **Core Skill:** the portable source bundle in `skills/explain-it-better`,
  distributed through the skills-only Codex/ChatGPT plugin and the separate
  Claude Code plugin.
- **Power mode:** the private local Node workspace that adds `eib`, `eib-mcp`,
  target-aware rendering, project-context selection, and evaluation.

The repository currently ships reviewed source bundles and does **not** publish
an npm package. All workspaces remain `private: true` deliberately. A release
is a reviewed, versioned Git commit (and, when the repository is public, an
appropriate GitHub Release), never an implied `npm publish` operation.

## Before the first push

1. Create the GitHub repository with no generated README, license, or
   `.gitignore`; decide its visibility before advertising installation links.
2. Add it as `origin`, push `main`, then protect `main`: require a pull request,
   one approving review, and the `Release gate (Node 22)` status check.
3. Grant the minimum repository access needed by maintainers and CI. The
   workflow needs only read access to repository contents.

## Cut a release

1. Start from a clean, current `main` and create a release branch.
2. Update the root and all workspace versions together. Keep internal
   `@eib/*` dependency versions aligned with the release version; update both
   plugin manifests to the same version.
3. Move relevant notes from `Unreleased` into a dated version heading in
   `CHANGELOG.md`.
4. Run `npm ci` followed by `npm run release:check` locally. This checks that
   every generated copy exactly matches the canonical Core Skill.
5. Run `npm link --workspace @eib/cli` and verify both commands resolve in a
   fresh interactive shell: `eib --version` and `eib-mcp`.
6. Validate the host adapters: `python3` skill/plugin validators for Codex and
   `claude plugin validate ./claude-plugin/explain-it-better` for Claude Code.
7. Install the local Codex marketplace once and confirm `codex plugin list`
   exposes `explain-it-better` without an MCP dependency.
8. Review the public optimizer claims against the shipped behavior: structured
   demand preservation, target-aware variants, demand-specific held-out
   evaluation, evidence-bound promotion, and any native execution boundary.
9. Open a pull request. Merge only after the CI release gate and required
   review are green.
10. Tag the merged commit as `vX.Y.Z` and create a GitHub Release whose notes
   match the changelog entry and whose visibility matches the repository.

## After release

- Verify the tag resolves to the merged commit and the GitHub Release has the
  intended visibility.
- If the repository is public, test both documented install paths from a clean
  machine or isolated user configuration before announcing it. If it is still
  private, do not present it as an installable public marketplace.
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
- Do not publish to npm. If registry distribution is ever approved,
  first change the package privacy policy, add provenance/registry controls,
  and review the release process separately.

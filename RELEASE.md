# Distribution and release process

EIB has two distributable layers:

- **Core Skill:** the portable source bundle in `skills/explain-it-better`,
  distributed through the skills-only Codex plugin and the separate
  Claude Code plugin.
- **Power mode:** the private local Node workspace that adds `eib`, `eib-mcp`,
  target-aware rendering, project-context selection, and evaluation.

The repository currently ships reviewed source bundles and does **not** publish
an npm package. All workspaces remain `private: true` deliberately. A release
is a reviewed, versioned Git commit (and, when the repository is public, an
appropriate GitHub Release), never an implied `npm publish` operation.

## Repository security baseline

1. Keep the public repository's visibility, description, support route, and
   release links current before advertising installation commands.
2. Protect `main`: enforce the strict `Release gate (Node 22)` status check,
   resolved review conversations, no force pushes, and no branch deletion.
3. Allow only the designated release owner to create `v*` tags and protect
   those tags from update and deletion. The tag-release workflow has the
   minimum additional `contents: write` permission needed to attach the checked
   source archive after validation succeeds.

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
6. Validate the host adapters with the checked-in commands:
   `npm run plugins:check`, and
   `claude plugin validate ./claude-plugin/explain-it-better` for Claude Code.
7. Install the local Codex marketplace once and confirm `codex plugin list`
   exposes `explain-it-better` without an MCP dependency.
8. Review the public optimizer claims against the shipped behavior: structured
   demand preservation, target-aware variants, demand-specific held-out
   evaluation, evidence-bound promotion, and any native execution boundary.
9. Open a pull request. Merge only after the CI release gate is green and all
   review conversations are resolved.
10. Create and push an annotated `vX.Y.Z` tag for the merged commit. The
    protected tag triggers the Release workflow, which verifies the exact tag,
    runs the full release gate, then creates or updates the GitHub Release with
    a deterministic source archive and SHA-256 checksum. Do not create a
    release manually before that workflow succeeds.

## After release

- Wait for the Release workflow to succeed, then run
  `npm run release:distribution` from the tagged checkout to prove the remote
  tag, private Power-mode source contract, and plugin distributions all match.
- Verify the GitHub Release has the intended visibility and both the source
  archive and SHA-256 checksum assets.
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

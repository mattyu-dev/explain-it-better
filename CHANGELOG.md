# Changelog

All notable changes to this repository are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-26

### Added

- A canonical, zero-dependency `explain-it-better` Agent Skill that turns rough
  requests into confirmation-gated execution briefs in any compatible host.
- Skills-only Codex/ChatGPT plugin, a separately validated Claude Code plugin,
  and a local Codex marketplace definition for installation testing.
- Generated-distribution guard: the CLI bundle and both host adapters must
  exactly match the canonical Skill during the release gate.
- Optional `eib-mcp` stdio server for Power-mode hosts that need target-aware
  local preparation and confirmation handoff tools.

### Changed

- Made the portable Skill the product default. CLI, repository context,
  target-aware rendering, evaluation, and MCP are explicit optional Power-mode
  capabilities rather than requirements for ordinary use.
- Updated `eib install` to place the portable Skill in generic `.agents`,
  Codex, and Claude project skill directories without modifying user-owned
  instruction files.

### Added

- Installable project-runtime flow: `eib install`, runtime-aware `eib transform`,
  confirmation handoff, scoped context manifests, explicit deep tracked-repo
  scanning, and managed Codex/Claude Code integration assets.
- Private-repository release documentation and a single `npm run release:check`
  gate for local and CI verification.
- Public documentation now defines EIB as a target-aware prompt optimizer:
  structured demand, target-aware prompt variants, demand-specific held-out
  evaluation, best-tested promotion, and paste-ready export.
- The optimizer documentation now specifies the full evidence loop: structured
  demand interpretation, target-aware candidate strategies, demand-specific
  held-out evaluation, imported or explicitly executed candidate evidence, and
  promotion bound to the exact demand, target, candidate hash, and case suite.
- Documented native OpenAI evaluation: complete static evidence first, then
  explicit `eval --mode live --backend openai --allow-execution` target and
  separate structured-judge runs with bounded evidence scope.
- Fail-closed knowledge refresh: `eib knowledge refresh` combines reviewed
  source-drift checks with allowlisted official provider catalog/release scans,
  producing evidence-only `discovered_unreviewed` candidates and a non-active
  proposal. A weekly read-only workflow uploads that evidence, runs the
  release gate, and requires human review for any drift, outage, or candidate.
- Evidence-only model promotion dossiers: `eib knowledge promote-plan
  <provider/model>` captures catalog evidence, source requirements, profile
  and rule review work, runtime/renderer tests, and evaluation gates without
  making a discovered model selectable or changing the active pack.

### Changed

- Reframed EIB's primary workflow as an automatic runtime prompt compiler:
  natural request to visible project-aware brief for the detected active agent.
- Removed agent deployment, MCP runtime, installation, and approval workflow
  framing from the user-facing product story. Evidence bundles are documented
  as reproducible prompt artifacts, not applications to run.
- Tightened public claims: static and proxy evidence are not target-model
  validation; native OpenAI runs require consent, an authorized credential, and
  have an explicit cost multiplier; and “best tested” is never presented as a
  universal or permanent quality claim.

## [0.1.0] - 2026-07-24

### Added

- Local, deterministic, provider-aware prompt compiler and terminal CLI.
- Reviewed target profiles, source-traceable knowledge rules, drift checks,
  static and proxy evaluation, and portable prompt export.
- Fail-closed verification labels, provider compatibility checks, and
  package-content validation.

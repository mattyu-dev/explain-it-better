# Explain It Better for Claude Code

A standalone Claude Code plugin that turns a rough request into an explicit,
approval-gated brief. It works without Node, an MCP server, a shell command, or
access to a local project. After the user approves the brief, Claude continues
with that confirmed scope in the same conversation.

## Install and use

### Try this checkout without installing

From the repository root:

```bash
claude --plugin-dir ./claude-plugin/explain-it-better
```

Then invoke the skill directly:

```text
/explain-it-better:explain-it-better Review our onboarding flow and tell me what to improve.
```

Claude can also discover the skill automatically when a request asks to clarify,
scope, structure, or improve a task before starting work.

### Install for your Claude Code user

Use Claude Code's plugin UI or add a marketplace that distributes this exact
plugin, then install `explain-it-better` at the desired scope. The standard
supported development path above requires no marketplace and is the fastest way
to verify the bundle.

To create a portable archive for Claude Code 2.1.128 or later, zip the
`explain-it-better` directory itself and test it before distributing:

```bash
cd claude-plugin
zip -r explain-it-better.zip explain-it-better
claude --plugin-dir ./explain-it-better.zip
```

Do not package only `.claude-plugin/`; `skills/` must remain at the plugin
root. Do not put the directory inside another directory layer in the archive.

## What happens in a conversation

1. The skill extracts the known goal, deliverable, audience, constraints, and
   success criteria from the request.
2. It asks one question only if a missing decision would materially alter the
   scope or result.
3. Otherwise it displays a concise proposed brief and any reversible
   assumptions.
4. It waits for a clear confirmation.
5. Only after confirmation does Claude begin the requested work.

The skill does not claim access to repository context or external facts it was
not given. Those can be gathered after confirmation if the host provides the
relevant tools and the confirmed request requires them.

## Validate before sharing

Run both checks from the repository root:

```bash
node claude-plugin/explain-it-better/scripts/validate.mjs
claude plugin validate ./claude-plugin/explain-it-better
```

The first is a dependency-free structural guard included in this bundle. The
second is Claude Code's authoritative plugin/schema validator. To smoke-test
runtime discovery, start Claude with `--plugin-dir` and verify that
`/explain-it-better:explain-it-better` appears in `/help`.

## Compatibility and limits

- Tested structure: Claude Code plugin layout with a root `skills/` directory
  and `.claude-plugin/plugin.json` manifest.
- Minimum version for zip loading: Claude Code 2.1.128. `displayName` metadata
  needs Claude Code 2.1.143 or later; older supported clients may simply show
  the plugin's machine name.
- This is a Claude Code plugin, not a Claude Desktop `.mcpb` extension. Claude
  Desktop needs its own supported distribution route if it is to load local
  skills directly.
- It deliberately contains no hooks or MCP configuration. Hooks enforce
  policies but cannot provide this conversational flow; MCP is optional power
  tooling and would break the zero-dependency core experience.

## Files

```text
explain-it-better/
├── .claude-plugin/plugin.json          # Claude Code plugin metadata
├── skills/explain-it-better/SKILL.md   # standalone behavior
└── scripts/validate.mjs                # local structural validation
```

Source license: Apache-2.0. See the repository's `LICENSE` file.

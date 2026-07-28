# First success: from request to confirmed handoff

This is the shortest complete **Power mode** path. It prepares a real project
request, shows the preview before work begins, requires a human confirmation,
then prints the exact handoff for the active agent. It does **not** make the
change by itself; the confirmed handoff is the point at which the agent may
begin the requested work.

## Assumptions

- Node.js 22+ and npm 10+ are installed.
- You have cloned this repository and are working in the project that you want
  an agent to prepare.
- You know the target you want. This example uses `openai-gpt-5.6-codex` so it
  remains deterministic even when the host does not expose its exact active
  model.

## 1. Install Power mode once

From an Explain It Better checkout:

```bash
npm install
npm run build
npm link --workspace @eib/cli
```

Then move to the project you want to prepare and install only EIB-owned local
assets. This never replaces `AGENTS.md`, `CLAUDE.md`, or other user-owned
instructions.

```bash
cd /path/to/your-project
eib install
```

## 2. Produce a preview — no work has started

Use a request that states a concrete deliverable and success check. Save the
machine-readable preview in a new EIB-owned directory; the guard refuses to
overwrite an existing file:

```bash
mkdir -p .eib/first-success
test ! -e .eib/first-success/preview.json || { echo "Refusing to overwrite .eib/first-success/preview.json" >&2; exit 1; }
eib transform \
  "Create a Markdown CONTRIBUTING.md for repository contributors. Include setup, tests, and pull-request steps. Success is a concise, actionable guide." \
  --for openai-gpt-5.6-codex \
  --json > .eib/first-success/preview.json
```

Review the target, visible assumptions, and selected context before continuing:

```bash
node -e 'const p = require("./.eib/first-success/preview.json"); console.log({ status: p.status, target: p.data.target.id, assumptions: p.data.assumptions, context: p.data.context.entries.filter((e) => e.included).map((e) => e.path) });'
```

Expected shape (the token and context paths vary by project):

```text
{
  status: 'ok',
  target: 'openai-gpt-5.6-codex',
  assumptions: [ ... ],
  context: [ 'README.md', 'package.json', ... ]
}
```

Stop here if the brief, assumptions, or selected project context are wrong.
Edit the request and run `transform` again; a preview is never approval.

## 3. Confirm after human review, then get the handoff

Only when the reviewer explicitly approves the preview, extract its run token
and confirm it:

```bash
token=$(node -e 'process.stdout.write(require("./.eib/first-success/preview.json").data.runToken)')
test ! -e .eib/first-success/handoff.json || { echo "Refusing to overwrite .eib/first-success/handoff.json" >&2; exit 1; }
eib confirm "$token" --json > .eib/first-success/handoff.json
node -e 'console.log(require("./.eib/first-success/handoff.json").data.handoff)'
```

The printed result begins with `# EIB execution contract`. Give that handoff to
the active agent (or let its native host integration receive it), then the
agent can inspect the selected context and create `CONTRIBUTING.md`. The
handoff keeps the preview’s task, selected-context fingerprints, assumptions,
and approval boundaries together.

The `.eib/first-success/` files are EIB-owned proof of this walkthrough. Keep
them while reviewing or delete that directory when the handoff is no longer
needed; the commands above never overwrite an existing preview or handoff.

## Verify this walkthrough locally

From this repository root, after `npm run build`:

```bash
node examples/first-success/verify.mjs
```

The verifier creates a temporary project, runs `install`, `transform`, and
`confirm`, then checks that the transform is confirmation-gated and the
confirmed result carries an execution contract. It makes no network or model
calls.

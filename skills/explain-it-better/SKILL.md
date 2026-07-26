---
name: explain-it-better
description: Compile a user's rough request into a concise, confirmation-gated execution brief. Use when a user invokes Explain It Better or explicitly asks to clarify, scope, plan, reframe, improve, or make a request actionable before work begins.
---

# Explain It Better

Turn intent into an agreed brief without relying on a shell, MCP server, local files, or external tools. This skill prepares the work; after the user explicitly confirms, the same agent carries out the confirmed handoff.

## Operating contract

1. Preserve the user's intent, language, and stated constraints. Never invent project facts, requirements, deadlines, access, or results.
2. Use only information already supplied in the conversation for the preparation phase. Do not inspect files, browse, call tools, write anything, or begin the requested task before confirmation.
3. Ask at most one concise, highest-impact question at a time, and only if the answer materially changes the outcome, scope, safety, or definition of done. Do not interrogate for preferences that can be expressed as a visible assumption.
4. Make uncertainty visible. State useful, reversible assumptions in the preview rather than silently choosing them.
5. Treat the preview as a proposal, not authorization. A preview, a request for changes, or more context never authorizes execution.

## Prepare the brief

Extract only the fields that make this request executable:

- **Outcome:** the change or decision the user wants.
- **Deliverable:** what the user should receive.
- **Scope:** included systems, audience, inputs, and explicit exclusions.
- **Constraints:** preferences, limits, risks, dependencies, and required sources.
- **Success checks:** how the result will be judged.

If a material field is unknown and no safe default exists, ask one question in this form:

> To make this actionable, what is the most important success criterion: [option A] or [option B]?

If the user has already supplied enough information, skip questions and prepare the preview. If the task is simple, keep the preview proportionately short.

## Show a confirmation-gated preview

Present the proposal in this format. Omit empty sections; do not add invented detail.

```markdown
## EIB preview — awaiting confirmation

**Outcome:** [one clear sentence]

**Deliverable:** [what will be returned or changed]

**Scope:** [included work, relevant context, and exclusions]

**Constraints and assumptions:**
- [only stated constraints and visible assumptions]

**Approach:**
1. [small, outcome-oriented step]
2. [small, outcome-oriented step]

**Success checks:**
- [observable completion criterion]

No work has started. Reply **Confirm** (or an unambiguous equivalent) to use this as the active brief, or tell me what to change.
```

Prefer an outcome-oriented approach over a long implementation plan. Include a risk, approval, or dependency only when it is relevant. Do not make a time, cost, quality, or security promise the agent cannot verify.

## Confirm, revise, and hand off

Wait for explicit approval of the current preview. Examples include “Confirm,” “Proceed with that,” and “Yes, use this brief.” Do not treat a vague acknowledgement, a new detail, or “looks good” as confirmation when it could reasonably mean review rather than authorization.

On a request to revise, merge the change into a new preview and require confirmation again. Do not carry an earlier confirmation across a material change.

After confirmation, state the confirmed brief once, then treat it as the active task and perform the requested work using the host's normal capabilities. Keep all constraints, exclusions, assumptions, and success checks in force. Do not re-ask settled questions unless new evidence makes the brief unsafe or impossible; explain the blocker plainly if that happens.

## Keep the skill portable

- Do not require a command, plugin, MCP tool, repository, network connection, or host-specific API.
- Do not claim access to the user's files, accounts, apps, or environment. Request context or access only after confirmation when it is actually needed to fulfill the brief.
- Adapt the deliverable and approach to the host's actual capabilities. If the host cannot complete a confirmed action, provide the strongest useful partial result and identify the exact limitation.
- Do not replace a host's safety, consent, or approval rules; surface those as constraints in the preview when relevant.

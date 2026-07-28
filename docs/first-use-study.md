# First-use study protocol

Use this protocol with five people who have not used Explain It Better before.
The goal is to test the first-success path, not to assess participants or
collect their work.

## Safety and consent

Before starting, say: participation is optional; stop at any time; do not share
credentials, API keys, personal data, customer data, repository URLs, file
paths, screenshots containing private information, or project source/code.
Use the supplied fictional request only. Record only the fields in the scorecard
below. Do not screen-record, retain terminal history, or copy a participant's
project material.

Keep individual scorecards private with the facilitator. After all five
sessions, the facilitator may publish a reviewed aggregate that removes or
generalises anything identifying. Security concerns must go through
`SECURITY.md`, not a public issue.

## Setup

- Recruit five people who plausibly match the intended technical audience and
  who have not used this project before.
- Give each person a fresh, disposable directory and the documented install
  path they would ordinarily use. Do not give hints unless the protocol says
  to do so.
- Use this fictional request verbatim:

  > Turn these rough notes into a decision-ready brief for a small product
  > launch: define the audience, success criteria, constraints, risks, open
  > questions, and a next-step plan. Keep it concise.

- Start a timer when the participant receives the instructions. Stop it when a
  preview is visible or when the participant stops.

## Session script

1. Say: “Please use Explain It Better to work on the fictional request. Think
   aloud if you are comfortable. I cannot help unless you ask a question.”
2. Observe without taking project material, terminal output, or personal
   details. Only record the scorecard fields below.
3. When a preview appears, ask: “What do you think **Confirm** will do?”
   Record the answer as their own words, then map it to the scorecard category.
4. Ask the participant whether they want to continue. If they choose to
   confirm, observe whether they can reach the handoff; if they decline, that
   is a valid outcome.
5. Ask: “What was the first thing that slowed you down?” Capture a short,
   non-sensitive summary. Do not ask for screenshots, source, or account data.
6. Keep the scorecard in the facilitator's private aggregate. Do not collect
   identifying details or submit individual session reports publicly.

## Scorecard

Record one row per participant with no name, handle, organisation, or project
identifier:

| Field | Allowed values / format |
| --- | --- |
| Path | `Marketplace Skill`, `Source-installed Power mode`, or `Other documented path` |
| Outcome | `Preview reached`, `Confirmed and handoff reached`, `Stopped by participant`, or `Blocked by product` |
| Time to preview | Whole minutes (or `not reached`) |
| Confirmation understanding | `Correct: authorises the next step`, `Partly correct`, `Incorrect`, or `Not asked` |
| Friction | One short, de-identified phrase, such as “could not find install command” |

## Success signals and follow-up

- A healthy first-use path reaches a preview without facilitator help and makes
  the confirmation boundary understandable.
- Treat any blocked attempt, incorrect understanding of confirmation, or
  repeated friction as a product finding, not participant error.
- Publish only a facilitator-reviewed aggregate of the five scorecard rows,
  if the participants have explicitly agreed. Remove or generalise anything
  that could identify a person, organisation, codebase, or secret before
  publication.
- Turn reproducible product findings into issues; do not publish credentials,
  source code, security reports, or private project details.

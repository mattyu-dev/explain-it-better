import type { AgentBlueprint } from "../contracts.js";

export type CandidateDimension =
  | "baseline"
  | "verification_emphasis"
  | "workflow_emphasis";

export interface PromptCandidate {
  id: string;
  dimension: CandidateDimension;
  blueprintId: string;
  semanticPrompt: string;
  changeLog: string[];
}

export interface GenerateCandidateOptions {
  maxCandidates?: 1 | 2 | 3;
}

function section(title: string, values: readonly string[]): string {
  return [`## ${title}`, ...values.map((value) => `- ${value}`)].join("\n");
}

function outputContract(blueprint: AgentBlueprint): string {
  const { outputContract: contract } = blueprint.intent;
  const schema = contract.schema;
  return [
    "## Output contract",
    `- Format: ${contract.format}`,
    `- Language: ${contract.language}`,
    `- Detail: ${contract.verbosity}`,
    ...(schema === undefined
      ? []
      : [
          "- The final output must validate against this JSON Schema:",
          "```json",
          JSON.stringify(schema, null, 2),
          "```",
        ]),
  ].join("\n");
}

function baselinePrompt(blueprint: AgentBlueprint): string {
  const { intent } = blueprint;
  return [
    `# Mission\n${intent.objective}`,
    `## Why this matters\n${intent.motivation}`,
    section("Deliverables", intent.deliverables),
    section("Audience", intent.audience),
    section("Hard constraints", intent.constraints.length > 0 ? intent.constraints : ["None specified."]),
    section(
      "Preferences",
      intent.preferences.length > 0 ? intent.preferences : ["No additional preferences specified."],
    ),
    section("Exclusions", intent.exclusions.length > 0 ? intent.exclusions : ["None specified."]),
    section(
      "Visible assumptions",
      intent.assumptions.length > 0 ? intent.assumptions : ["Do not add unstated assumptions."],
    ),
    section("Success criteria", intent.successCriteria),
    section(
      "Evidence requirements",
      intent.evidenceRequirements.length > 0
        ? intent.evidenceRequirements
        : ["Use evidence appropriate to the task; do not invent facts."],
    ),
    section(
      "Typed inputs",
      blueprint.typedInputs.length > 0
        ? blueprint.typedInputs.map(
            (input) =>
              `${input.name} (${input.required ? "required" : "optional"}, ${input.provenance}): ${input.description}`,
          )
        : ["No external inputs declared."],
    ),
    section(
      "Context and provenance",
      intent.context.length > 0
        ? intent.context.map(
            (entry) => `${entry.source} [${entry.trust}]: ${entry.summary}`,
          )
        : ["No additional context supplied."],
    ),
    outputContract(blueprint),
    section("Operating policy", blueprint.roles.policy),
    section(
      "Approval boundary",
      blueprint.approvals.requiredFor.length > 0
        ? blueprint.approvals.requiredFor.map(
            (boundary) => `${boundary}: obtain and record human approval before acting.`,
          )
        : ["Consequential external actions are forbidden."],
    ),
    "Execute the mission. Return the deliverable, material assumptions, evidence, and verification results. Do not reveal hidden chain-of-thought.",
  ].join("\n\n");
}

function verificationVariant(base: string, blueprint: AgentBlueprint): string {
  return [
    base,
    section("Verification protocol", [
      ...blueprint.intent.successCriteria.map(
        (criterion) => `Check and report pass/fail evidence for: ${criterion}`,
      ),
      "Treat any violated hard constraint as a critical failure.",
      "If a criterion cannot be verified, label it unverified rather than claiming success.",
    ]),
  ].join("\n\n");
}

function workflowVariant(base: string, blueprint: AgentBlueprint): string {
  return [
    base,
    section(
      "Execution workflow",
      blueprint.workflow.map(
        (step) =>
          `${step.id}: ${step.instruction} Verification: ${step.verification}`,
      ),
    ),
  ].join("\n\n");
}

/**
 * Produces at most three neutral candidates. Each non-baseline candidate changes
 * exactly one documented prompting dimension while preserving frozen intent.
 */
export function generatePromptCandidates(
  blueprint: AgentBlueprint,
  options: GenerateCandidateOptions = {},
): PromptCandidate[] {
  const maximum = options.maxCandidates ?? 3;
  const base = baselinePrompt(blueprint);
  const all: PromptCandidate[] = [
    {
      id: `${blueprint.id}-baseline`,
      dimension: "baseline",
      blueprintId: blueprint.id,
      semanticPrompt: base,
      changeLog: ["Canonical intent-preserving baseline."],
    },
    {
      id: `${blueprint.id}-verification`,
      dimension: "verification_emphasis",
      blueprintId: blueprint.id,
      semanticPrompt: verificationVariant(base, blueprint),
      changeLog: ["Added an explicit criterion-by-criterion verification protocol."],
    },
    {
      id: `${blueprint.id}-workflow`,
      dimension: "workflow_emphasis",
      blueprintId: blueprint.id,
      semanticPrompt: workflowVariant(base, blueprint),
      changeLog: ["Added the blueprint workflow as an explicit execution sequence."],
    },
  ];
  return all.slice(0, maximum);
}

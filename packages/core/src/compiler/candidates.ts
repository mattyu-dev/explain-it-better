import { createHash } from "node:crypto";

import type { PromptSpec } from "../contracts.js";

export type CandidateDimension =
  | "baseline"
  | "verification_emphasis"
  | "reasoning_structure";

export interface PromptCandidate {
  id: string;
  dimension: CandidateDimension;
  promptSpecId: string;
  semanticPrompt: string;
  promptHash: string;
  changeLog: string[];
}

export interface GenerateCandidateOptions {
  maxCandidates?: 1 | 2 | 3;
}

function section(title: string, values: readonly string[]): string {
  return [`## ${title}`, ...values.map((value) => `- ${value}`)].join("\n");
}

function outputContract(prompt: PromptSpec): string {
  const { outputContract: contract } = prompt.demand;
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

function baselinePrompt(prompt: PromptSpec): string {
  const { demand } = prompt;
  return [
    `# Task\n${demand.objective}`,
    `## Why this matters\n${demand.motivation}`,
    section("Deliverables", demand.deliverables),
    section("Audience", demand.audience),
    section("Hard constraints", demand.constraints.length > 0 ? demand.constraints : ["None specified."]),
    section(
      "Preferences",
      demand.preferences.length > 0 ? demand.preferences : ["No additional preferences specified."],
    ),
    section("Exclusions", demand.exclusions.length > 0 ? demand.exclusions : ["None specified."]),
    section(
      "Visible assumptions",
      demand.assumptions.length > 0 ? demand.assumptions : ["Do not add unstated assumptions."],
    ),
    section("Success criteria", demand.successCriteria),
    section(
      "Evidence requirements",
      demand.evidenceRequirements.length > 0
        ? demand.evidenceRequirements
        : ["Use evidence appropriate to the task; do not invent facts."],
    ),
    section(
      "Typed inputs",
      prompt.inputBindings.length > 0
        ? prompt.inputBindings.map(
            (input) =>
              `${input.name} (${input.required ? "required" : "optional"}, ${input.provenance}): ${input.description}`,
          )
        : ["No external inputs declared."],
    ),
    section(
      "Context and provenance",
      demand.context.length > 0
        ? demand.context.map(
            (entry) => `${entry.source} [${entry.trust}]: ${entry.summary}`,
          )
        : ["No additional context supplied."],
    ),
    outputContract(prompt),
    `## Role\n${prompt.guidance.role}`,
    section("Response principles", prompt.guidance.principles),
    "Return the requested deliverable, material assumptions, and evidence where relevant. Do not narrate private reasoning.",
  ].join("\n\n");
}

function verificationVariant(base: string, prompt: PromptSpec): string {
  return [
    base,
    section("Verification protocol", [
      ...prompt.demand.successCriteria.map(
        (criterion) => `Check and report pass/fail evidence for: ${criterion}`,
      ),
      "Treat any violated hard constraint as a critical failure.",
      "If a criterion cannot be verified, label it unverified rather than claiming success.",
    ]),
  ].join("\n\n");
}

function reasoningStructureVariant(base: string, prompt: PromptSpec): string {
  return [
    base,
    section(
      "Recommended approach",
      prompt.guidance.method,
    ),
  ].join("\n\n");
}

/**
 * Produces at most three neutral candidates. Each non-baseline candidate changes
 * exactly one documented prompting dimension while preserving frozen intent.
 */
export function generatePromptCandidates(
  prompt: PromptSpec,
  options: GenerateCandidateOptions = {},
): PromptCandidate[] {
  const maximum = options.maxCandidates ?? 3;
  const base = baselinePrompt(prompt);
  const candidate = (id: string, dimension: CandidateDimension, semanticPrompt: string, changeLog: string[]): PromptCandidate => ({
    id,
    dimension,
    promptSpecId: prompt.id,
    semanticPrompt,
    promptHash: createHash("sha256").update(semanticPrompt).digest("hex"),
    changeLog,
  });
  const all: PromptCandidate[] = [
    candidate(`${prompt.id}-baseline`, "baseline", base, ["Canonical demand-preserving baseline."]),
    candidate(`${prompt.id}-verification`, "verification_emphasis", verificationVariant(base, prompt), ["Added an explicit criterion-by-criterion verification protocol."]),
    candidate(`${prompt.id}-reasoning`, "reasoning_structure", reasoningStructureVariant(base, prompt), ["Added a concise answer-planning structure without requesting private reasoning."]),
  ];
  return all.slice(0, maximum);
}

import { createHash } from "node:crypto";

import type { PromptSpec, TargetProfile } from "../contracts.js";

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
  /**
   * Optional target facts that can tune the *response strategy*. The frozen
   * demand remains identical in every candidate; rendering remains responsible
   * for target-specific transport syntax.
   */
  target?: TargetProfile;
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

function frozenDemand(prompt: PromptSpec): string {
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
  ].join("\n\n");
}

function targetGuidance(prompt: PromptSpec, target?: TargetProfile): string {
  if (target === undefined) {
    return section("Target adaptation", [
      "Use plain, self-contained instructions that remain portable across capable chat and API targets.",
      "Do not rely on undeclared tools, hidden context, or provider-specific control syntax.",
    ]);
  }

  const guidance = [
    `Optimize the response for ${target.provider} ${target.model} on its ${target.surface} surface.`,
    "Keep semantic instructions portable; the renderer, not this prompt, owns transport syntax and provider control fields.",
  ];
  if (prompt.demand.outputContract.schema !== undefined) {
    guidance.push(
      target.supports.structuredOutput
        ? "Treat the declared JSON Schema as a hard output boundary; emit no prose outside the required JSON value."
        : "The target cannot enforce structured output natively; still emit one valid JSON value matching the declared schema with no surrounding prose.",
    );
  }
  if (target.reasoning.modes.some((mode) => mode !== "none" && mode !== "non-reasoning")) {
    guidance.push(
      "Use the target's available reasoning capacity to check dependencies and trade-offs internally; expose conclusions and concise decision rationale, never private chain-of-thought.",
    );
  }
  if (target.surface === "chat_app") {
    guidance.push("Make the answer self-contained because it may be pasted into a conversational surface without API controls.");
  }
  if (target.surface === "coding_cli") {
    guidance.push("For implementation work, make the chosen plan and verification evidence easy for an operator to act on.");
  }
  return section("Target adaptation", guidance);
}

function baselinePrompt(prompt: PromptSpec, target?: TargetProfile): string {
  return [
    frozenDemand(prompt),
    `## Role\n${prompt.guidance.role}`,
    section("Response principles", prompt.guidance.principles),
    section("Strategy: direct delivery", [
      "Deliver the requested result directly, with the most decision-useful content first.",
      "Use the specified format, language, and detail level exactly; do not add process narration or an unrequested appendix.",
      "State only material assumptions and uncertainty that affect the result.",
    ]),
    targetGuidance(prompt, target),
    "Return the requested deliverable, material assumptions, and evidence where relevant. Do not narrate private reasoning.",
  ].join("\n\n");
}

function verificationVariant(prompt: PromptSpec, target?: TargetProfile): string {
  return [
    frozenDemand(prompt),
    `## Role\n${prompt.guidance.role}`,
    section("Response principles", prompt.guidance.principles),
    section("Strategy: evidence-led delivery", [
      "Build the requested result around claims that can be traced to supplied context or appropriate evidence.",
      "For each success criterion, perform a final check before responding. Treat a violated hard constraint as a critical failure.",
      "When a claim cannot be verified, state the uncertainty or the missing evidence instead of implying certainty.",
      "When alternatives matter, compare them only against the frozen constraints and success criteria, then state the selected option and its evidence-based rationale.",
      "Keep verification concise and inside the requested output contract; do not invent a separate report unless the contract asks for one.",
    ]),
    targetGuidance(prompt, target),
    "Return conclusions, material assumptions, and evidence appropriate to the task. Do not narrate private reasoning.",
  ].join("\n\n");
}

function reasoningStructureVariant(prompt: PromptSpec, target?: TargetProfile): string {
  return [
    frozenDemand(prompt),
    `## Role\n${prompt.guidance.role}`,
    section("Response principles", prompt.guidance.principles),
    section(
      "Strategy: decision-ready synthesis",
      [
        "Before drafting, identify the decisions, dependencies, and trade-offs that determine whether the deliverable will be useful.",
        "Use this method to organize the work:",
        ...prompt.guidance.method.map((step, index) => `${String(index + 1)}. ${step}`),
        "Where multiple viable approaches exist, choose the one that best satisfies the frozen success criteria and explain the decision in a concise, user-visible rationale.",
        "Make next actions, acceptance conditions, and unresolved risks explicit when they materially affect the requested result.",
        "Do the substantive reasoning internally; return the decision, its brief rationale, and the requested deliverable rather than hidden chain-of-thought.",
      ],
    ),
    targetGuidance(prompt, target),
    "Return a decision-ready result in the exact requested output contract.",
  ].join("\n\n");
}

/**
 * Produces at most three materially distinct response strategies while
 * preserving the same frozen demand. Target facts may tune execution guidance,
 * but never add, remove, or reinterpret a requirement from that demand.
 */
export function generatePromptCandidates(
  prompt: PromptSpec,
  options: GenerateCandidateOptions = {},
): PromptCandidate[] {
  const maximum = options.maxCandidates ?? 3;
  const candidate = (id: string, dimension: CandidateDimension, semanticPrompt: string, changeLog: string[]): PromptCandidate => ({
    id,
    dimension,
    promptSpecId: prompt.id,
    semanticPrompt,
    promptHash: createHash("sha256").update(semanticPrompt).digest("hex"),
    changeLog,
  });
  const all: PromptCandidate[] = [
    candidate(`${prompt.id}-baseline`, "baseline", baselinePrompt(prompt, options.target), ["Uses a direct-delivery strategy that prioritizes format fidelity and concise results."]),
    candidate(`${prompt.id}-verification`, "verification_emphasis", verificationVariant(prompt, options.target), ["Uses an evidence-led strategy that trades brevity for criterion checks and calibrated claims."]),
    candidate(`${prompt.id}-reasoning`, "reasoning_structure", reasoningStructureVariant(prompt, options.target), ["Uses a decision-ready synthesis strategy that surfaces choices, trade-offs, and acceptance conditions."]),
  ];
  return all.slice(0, maximum);
}

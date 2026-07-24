import { describe, expect, it } from "vitest";

import { buildPromptSpec } from "../blueprint/index.js";
import { type PromptSpec } from "../contracts.js";
import { analyzeBrief, createFastDraft } from "../intent/index.js";
import { makePromptPackage } from "../package/test-fixtures.js";
import {
  DemandSpecificEvaluationSuiteSchema,
  generateDemandSpecificEvaluationSuite,
  promptSpecHash,
} from "./suite.js";

const REQUIRED_CATEGORIES = [
  "nominal",
  "ambiguous",
  "edge",
  "multilingual",
  "adversarial",
  "should_not_act",
  "tool_failure",
  "long_context",
  "refusal",
  "output_schema",
];

function promptFor(brief: string, overrides: Record<string, unknown> = {}): PromptSpec {
  const demand = createFastDraft(analyzeBrief(brief, {
    deliverables: ["Prioritized implementation plan"],
    successCriteria: ["Identifies the highest-leverage improvements", "Explains evidence and tradeoffs"],
    outputFormat: "Markdown",
    ...overrides,
  }));
  return buildPromptSpec(demand);
}

describe("demand-specific evaluation suite", () => {
  it("derives a complete, task-specific suite deterministically without mutating the prompt", () => {
    const prompt = promptFor("Deeply inspect this project and propose improvements.");
    const before = JSON.stringify(prompt);

    const first = generateDemandSpecificEvaluationSuite(prompt);
    const second = generateDemandSpecificEvaluationSuite(prompt);

    expect(first).toEqual(second);
    expect(JSON.stringify(prompt)).toBe(before);
    expect(first.promptSpecId).toBe(prompt.id);
    expect(first.promptSpecHash).toBe(promptSpecHash(prompt));
    expect(first.generation.method).toBe("deterministic_demand_derived");
    expect(first.generation.sourceFields).toContain("successCriteria");
    expect(first.cases.map((evalCase) => evalCase.category)).toEqual(REQUIRED_CATEGORIES);
    expect(first.cases.every((evalCase) => evalCase.expectedProperties.join(" ").includes("Prioritized implementation plan"))).toBe(true);
    expect(first.cases.find((evalCase) => evalCase.category === "long_context")?.input).toContain("late, relevant requirement");
  });

  it("binds suites to the complete prompt specification, not only its ID", () => {
    const prompt = promptFor("Audit a repository.");
    const changed: PromptSpec = {
      ...prompt,
      demand: {
        ...prompt.demand,
        constraints: ["Do not access production data."],
      },
    };

    const initial = generateDemandSpecificEvaluationSuite(prompt);
    const updated = generateDemandSpecificEvaluationSuite(changed);

    expect(updated.promptSpecId).toBe(initial.promptSpecId);
    expect(updated.promptSpecHash).not.toBe(initial.promptSpecHash);
    expect(updated.cases.map((evalCase) => evalCase.id)).not.toEqual(initial.cases.map((evalCase) => evalCase.id));
    expect(updated.cases[0]?.rubric.join(" ")).toContain("Do not access production data.");
  });

  it("preserves safety cases and makes their safety rationale auditable when the demand is high-risk", () => {
    const prompt = promptFor("Write a medical triage guide.", {
      constraints: ["Do not provide medical diagnosis or treatment advice."],
      evidenceRequirements: ["Use cited clinical guidance."],
      risk: "high",
    });
    const suite = generateDemandSpecificEvaluationSuite(prompt);

    expect(suite.generation.safetyRelevant).toBe(true);
    expect(suite.generation.safetySignals).toEqual(expect.arrayContaining(["risk:high", "matched:constraints"]));
    for (const category of ["adversarial", "should_not_act", "tool_failure", "refusal"] as const) {
      const evalCase = suite.cases.find((candidate) => candidate.category === category);
      expect(evalCase?.rubric.join(" ")).toContain("high-risk");
    }
  });

  it("adds a JSON deterministic check only when the frozen output contract requires JSON", () => {
    const jsonPrompt = buildPromptSpec(createFastDraft(analyzeBrief("Extract the title.", {
      deliverables: ["Structured extraction"],
      successCriteria: ["The title is faithfully extracted"],
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    })));
    const suite = generateDemandSpecificEvaluationSuite(jsonPrompt);

    expect(suite.cases.find((evalCase) => evalCase.category === "output_schema")?.deterministicChecks).toEqual([
      "non_empty",
      "valid_json",
    ]);
  });

  it("round-trips through JSON for storage and rejects a suite with a missing category", () => {
    const suite = generateDemandSpecificEvaluationSuite(makePromptPackage().prompt);
    expect(DemandSpecificEvaluationSuiteSchema.parse(JSON.parse(JSON.stringify(suite)))).toEqual(suite);
    expect(() => DemandSpecificEvaluationSuiteSchema.parse({
      ...suite,
      cases: suite.cases.slice(1),
    })).toThrow(/required evaluation category/iu);
  });
});

import { describe, expect, it } from "vitest";

import { analyzeBrief, createFastDraft } from "../intent/index.js";
import { analyzeTaskRequirements, buildPromptSpec } from "./index.js";

describe("prompt specification construction", () => {
  it("refuses unresolved blocking ambiguity", () => {
    expect(() => buildPromptSpec(analyzeBrief("Help me with this."))).toThrow(/blocking ambiguity/iu);
  });

  it("freezes a human demand without runtime configuration", () => {
    const prompt = buildPromptSpec(createFastDraft(analyzeBrief("Write a launch plan.", {
      deliverables: ["Launch plan"],
      successCriteria: ["The plan is actionable"],
      inputs: ["Product URL", "Product-URL", "Product_URL"],
    })));

    expect(Object.isFrozen(prompt.demand)).toBe(true);
    expect(prompt.guidance.method).toHaveLength(3);
    expect(prompt.evaluation.candidateDimensions).toEqual([
      "baseline", "verification_emphasis", "reasoning_structure",
    ]);
    expect(prompt.inputBindings.map((input) => input.name)).toEqual([
      "product_url", "product_url_2", "product_url_3",
    ]);
    expect(JSON.stringify(prompt)).not.toMatch(/mcp|permission|subagent|approval|tool/iu);
  });

  it("produces a stable prompt id for the same frozen demand", () => {
    const demand = createFastDraft(analyzeBrief("Build a complete test plan."));
    expect(buildPromptSpec(demand).id).toBe(buildPromptSpec(demand).id);
  });

  it("still describes prompt-relevant requirements from the demand", () => {
    const demand = createFastDraft(analyzeBrief(
      "Research the latest sources and inspect an image.",
      {
        deliverables: ["JSON report"],
        successCriteria: ["Citations and valid JSON are present"],
        outputFormat: "JSON",
      },
    ));
    const requirements = analyzeTaskRequirements(demand);
    expect(requirements.retrieval).toBe(true);
    expect(requirements.structuredOutput).toBe(true);
    expect(requirements.image).toBe(true);
  });
});

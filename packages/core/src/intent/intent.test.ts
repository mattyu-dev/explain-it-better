import { describe, expect, it } from "vitest";

import {
  acceptRecommendedAssumption,
  analyzeBrief,
  answerClarification,
  createFastDraft,
  freezeIntentContract,
  selectNextQuestion,
} from "./index.js";

describe("adaptive intent compiler", () => {
  it("preserves the complete original brief and extracts explicit sections", () => {
    const brief = [
      "Build a launch plan for a local AI product.",
      "Audience: solo founders; product leads",
      "Deliverables: launch checklist; announcement draft",
      "Constraints: no paid ads",
      "Success criteria: executable in seven days",
      "Output: Markdown",
    ].join("\n");

    const intent = analyzeBrief(brief);

    expect(intent.objective).toBe("Build a launch plan for a local AI product.");
    expect(intent.audience).toEqual(["solo founders", "product leads"]);
    expect(intent.deliverables).toEqual(["launch checklist", "announcement draft"]);
    expect(intent.constraints).toEqual(["no paid ads"]);
    expect(intent.successCriteria).toEqual(["executable in seven days"]);
    expect(intent.outputContract.format).toBe("Markdown");
    expect(intent.context[0]?.summary).toBe(brief);
    expect(intent.unresolvedAmbiguity).toEqual([]);
  });

  it("parses multiline Markdown sections without leaking later prose into them", () => {
    const intent = analyzeBrief(
      [
        "Prepare an implementation plan.",
        "Deliverables:",
        "- A phased rollout plan",
        "- A verification checklist",
        "Constraints:",
        "  - Preserve unrelated local changes",
        "  - Do not expand the product scope",
        "Output format:",
        "- Markdown",
        "Notes: This is context, not another deliverable.",
      ].join("\n"),
    );

    expect(intent.deliverables).toEqual(["A phased rollout plan", "A verification checklist"]);
    expect(intent.constraints).toEqual([
      "Preserve unrelated local changes",
      "Do not expand the product scope",
    ]);
    expect(intent.outputContract.format).toBe("Markdown");
    expect(intent.deliverables).not.toContain("This is context, not another deliverable.");
  });

  it("preserves coordinated list items and exclusions in a long untrusted brief", () => {
    const brief = [
      "Audience: research, and product leads; operators",
      "Constraints: preserve evidence",
      "Never invent a value; emit null with evidence.",
      "Context: ".concat("reviewed input ".repeat(4_000)),
    ].join("\n");

    const intent = analyzeBrief(brief);

    expect(intent.audience).toEqual(["research, and product leads", "operators"]);
    expect(intent.constraints).toEqual(["preserve evidence"]);
    expect(intent.exclusions).toEqual(["Never invent a value"]);
  });

  it("keeps a long explicit return deliverable intact and recognises its requested plan format", () => {
    const brief = [
      "Deeply inspect this Explain It Better repository and its real product purpose.",
      "Identify the highest-leverage improvements that would make it substantially better at turning a human demand into the best-tested prompt for a chosen target model.",
      "Ground every finding in the current code, docs, tests, CLI behavior, and product boundaries.",
      "Distinguish defects, missing capabilities, and intentionally deferred scope.",
      "Return a prioritized implementation plan with evidence, expected user impact, and verification criteria; do not propose agent-runtime, MCP, installer, or deployment features.",
    ].join(" ");

    const intent = analyzeBrief(brief);

    expect(intent.deliverables).toEqual([
      "prioritized implementation plan with evidence, expected user impact, and verification criteria",
    ]);
    expect(intent.exclusions).toEqual([
      "do not propose agent-runtime, MCP, installer, or deployment features",
    ]);
    expect(intent.outputContract.format).toBe("plan");
    expect(intent.unresolvedAmbiguity.map((item) => item.field)).not.toContain(
      "outputContract.format",
    );
  });

  it("does not treat incidental code mentions as a requested code output", () => {
    const intent = analyzeBrief(
      "Inspect the current code, docs, and tests. Return a prioritized implementation plan.",
    );

    expect(intent.outputContract.format).toBe("plan");
    expect(intent.outputContract.format).not.toBe("code");
  });

  it("infers an architecture review and next-step artifact from ordinary project language", () => {
    const intent = analyzeBrief(
      "I want you to review the architecture to be sure that everything is perfectly wired, what are the next steps to update the project",
    );

    expect(intent.deliverables).toEqual([
      "architecture review and prioritized next steps to update the project",
    ]);
    expect(intent.unresolvedAmbiguity.map((item) => item.field)).not.toContain("deliverables");
  });

  it("moves a sentence-level do-not clause into exclusions", () => {
    const intent = analyzeBrief(
      "Return an implementation plan. Do not recommend unverified provider integrations.",
    );

    expect(intent.deliverables).toEqual(["implementation plan"]);
    expect(intent.exclusions).toEqual(["Do not recommend unverified provider integrations"]);
  });

  it("keeps a required fallback after a semicolon out of the exclusion", () => {
    const intent = analyzeBrief(
      "Extract every invoice line into our schema. Never invent a missing value; emit an explicit null and evidence pointer.",
    );

    expect(intent.exclusions).toEqual(["Never invent a missing value"]);
    expect(intent.exclusions).not.toContain("emit an explicit null and evidence pointer");
  });

  it("keeps the output-format question open when no output artifact or format is requested", () => {
    const intent = analyzeBrief("Inspect the code, docs, and tests for improvements.");

    expect(intent.outputContract.format).toBe("Unspecified format");
    expect(intent.unresolvedAmbiguity.map((item) => item.field)).toContain(
      "outputContract.format",
    );
  });

  it("asks the highest-impact question first and exposes all three paths", () => {
    const intent = analyzeBrief("Help me improve this.");
    const question = selectNextQuestion(intent);

    expect(question?.field).toBe("deliverables");
    expect(question?.impact).toBe("blocking");
    expect(question?.paths.map((path) => path.id)).toEqual([
      "answer",
      "recommended_assumption",
      "fast_draft",
    ]);
  });

  it("records recommended assumptions but not direct user answers", () => {
    const initial = analyzeBrief("Write something useful.");
    const answered = answerClarification(initial, "audience", "New engineering managers");
    const assumed = acceptRecommendedAssumption(answered, "successCriteria");

    expect(answered.audience).toEqual(["New engineering managers"]);
    expect(answered.assumptions).toEqual([]);
    expect(assumed.assumptions[0]).toContain("successCriteria:");
  });

  it("creates a schema-valid fast draft with every assumption visible", () => {
    const initial = analyzeBrief("Research current prompting patterns.");
    const fast = createFastDraft(initial);

    expect(fast.unresolvedAmbiguity).toEqual([]);
    expect(fast.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(fast.evidenceRequirements[0]).toContain("primary sources");
  });

  it("recursively freezes a cloned intent", () => {
    const source = createFastDraft(analyzeBrief("Build a small CLI."));
    const frozen = freezeIntentContract(source);

    expect(frozen).not.toBe(source);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.constraints)).toBe(true);
    expect(Object.isFrozen(frozen.outputContract)).toBe(true);
  });

  it("accepts and validates an optional structured-output schema hint", () => {
    const intent = analyzeBrief("Extract the article title.", {
      audience: ["API consumer"],
      deliverables: ["Structured extraction"],
      successCriteria: ["The title is faithfully extracted"],
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    });

    expect(intent.outputContract.format).toBe("JSON");
    expect(intent.outputContract.schema?.["type"]).toBe("object");
    expect(intent.unresolvedAmbiguity.map((item) => item.field)).not.toContain(
      "outputContract.format",
    );
    expect(() =>
      analyzeBrief("Extract a title.", {
        outputSchema: { properties: { title: { type: "string" } } },
      }),
    ).toThrow(/root type/iu);
  });

  it("asks launch-video questions for product, duration, distribution, and assets", () => {
    const intent = analyzeBrief("Create a launch video for our product.");
    const fields = intent.unresolvedAmbiguity.map((item) => item.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        "inputs.product",
        "preferences.duration",
        "preferences.distribution",
        "inputs.assets",
      ]),
    );
    expect(selectNextQuestion(intent)?.field).toBe("inputs.product");

    const withProduct = answerClarification(intent, "inputs.product", "Nomador");
    const withDuration = answerClarification(
      withProduct,
      "preferences.duration",
      "30 seconds",
    );
    expect(withDuration.inputs).toContain("Nomador");
    expect(withDuration.preferences).toContain("30 seconds");
    expect(withDuration.unresolvedAmbiguity.map((item) => item.field)).toContain(
      "inputs.assets",
    );
  });

  it("recognizes explicit launch-video domain sections", () => {
    const intent = analyzeBrief(
      [
        "Create a product launch video.",
        "Product: Nomador",
        "Assets: product URL and brand kit",
        "Duration: 45 seconds",
        "Distribution: YouTube and website",
      ].join("\n"),
    );
    const fields = intent.unresolvedAmbiguity.map((item) => item.field);

    expect(fields).not.toEqual(
      expect.arrayContaining([
        "inputs.product",
        "preferences.duration",
        "preferences.distribution",
        "inputs.assets",
      ]),
    );
    expect(intent.inputs).toEqual([
      "Product: Nomador",
      "Assets: product URL and brand kit",
    ]);
    expect(intent.preferences).toEqual([
      "Duration: 45 seconds",
      "Distribution: YouTube and website",
    ]);
  });

  it("still asks for launch-video assets when only the product is known", () => {
    const intent = analyzeBrief(
      [
        "Create a product launch video.",
        "Product: Nomador",
        "Duration: 30 seconds",
        "Distribution: YouTube",
      ].join("\n"),
    );
    const fields = intent.unresolvedAmbiguity.map((item) => item.field);

    expect(fields).not.toContain("inputs.product");
    expect(fields).toContain("inputs.assets");
  });

  it("does not mistake an arbitrary input for launch-video product evidence", () => {
    const intent = analyzeBrief(
      [
        "Create a product launch video.",
        "Inputs: competitor screenshots",
        "Duration: 30 seconds",
        "Distribution: YouTube",
      ].join("\n"),
    );

    expect(intent.unresolvedAmbiguity.map((item) => item.field)).toContain("inputs.product");
  });

  it("replaces top-level inputs and preferences clarification fields", () => {
    const intent = analyzeBrief("Build a plan.", {
      audience: ["Project team"],
      deliverables: ["Implementation plan"],
      successCriteria: ["The plan is actionable"],
      outputFormat: "Markdown",
    });
    intent.unresolvedAmbiguity = [
      {
        field: "inputs",
        question: "Which inputs are available?",
        impact: "high",
        recommendedAssumption: "Use only the brief.",
      },
      {
        field: "preferences",
        question: "Which preferences apply?",
        impact: "safe",
        recommendedAssumption: "Use balanced defaults.",
      },
    ];

    const withInputs = answerClarification(intent, "inputs", "Product requirements");
    const complete = answerClarification(withInputs, "preferences", "Prefer a staged rollout");

    expect(complete.inputs).toEqual(["Product requirements"]);
    expect(complete.preferences).toEqual(["Prefer a staged rollout"]);
  });
});

import type { EvalCase, PromptPackage } from "../contracts.js";

const categories: readonly EvalCase["category"][] = [
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

export function makePromptPackage(): PromptPackage {
  return {
    version: "1.0.0",
    id: "example-package",
    createdAt: "2026-07-24T10:00:00.000Z",
    originalBrief: "Create a concise, evidence-backed answer.",
    clarificationLineage: [
      {
        question: "Who is the audience?",
        answer: "A technical reader",
        assumed: false,
      },
    ],
    blueprint: {
      version: "1.0.0",
      id: "example-blueprint",
      intent: {
        version: "1.0.0",
        objective: "Create a concise, evidence-backed answer.",
        motivation: "Help a technical reader decide.",
        audience: ["technical reader"],
        deliverables: ["answer"],
        inputs: ["user brief"],
        context: [
          {
            id: "brief",
            source: "original brief",
            trust: "user",
            summary: "The user's request.",
          },
        ],
        constraints: ["Do not invent evidence."],
        preferences: ["Be concise."],
        exclusions: ["Hidden chain-of-thought"],
        assumptions: [],
        successCriteria: ["The answer addresses the brief."],
        evidenceRequirements: ["Cite supplied evidence."],
        outputContract: {
          format: "markdown",
          language: "English",
          verbosity: "concise",
          schema: { type: "object" },
        },
        risk: "low",
        unresolvedAmbiguity: [],
      },
      roles: {
        identity: "A careful assistant",
        policy: ["Follow the frozen intent contract."],
      },
      workflow: [
        {
          id: "answer",
          instruction: "Answer the request.",
          dependsOn: [],
          verification: "Check the success criteria.",
        },
      ],
      subagents: [],
      tools: [],
      mcpServers: [],
      typedInputs: [
        {
          name: "user_brief",
          description: "user brief",
          required: true,
          schema: { type: "string" },
          provenance: "user",
        },
      ],
      memory: {
        enabled: false,
        scope: "none",
        retention: "No retention",
        writePolicy: "Never write",
      },
      permissions: {
        filesystem: "none",
        network: "none",
        externalActions: "forbidden",
      },
      approvals: {
        requiredFor: [],
        approver: "human",
        recordPolicy: "Record every approved consequential action.",
      },
      budgets: {
        maxTurns: 3,
        maxMinutes: 5,
        tokenGuidance: 2000,
      },
      verification: {
        criteria: ["The answer addresses the brief."],
        evidencePolicy: "Cite supplied evidence.",
        independentReview: false,
      },
      stoppingRules: ["Stop when success criteria are verified."],
      failureHandling: ["State missing evidence."],
    },
    artifacts: [
      {
        targetId: "openai-gpt",
        filename: "prompt.md",
        content: "Answer the request and cite supplied evidence.",
        mimeType: "text/markdown",
        warnings: [],
      },
    ],
    warnings: [],
    evals: categories.map((category, index) => ({
      id: `case-${index + 1}`,
      category,
      input: `Input for ${category}`,
      expectedProperties: ["Returns a useful answer."],
      deterministicChecks: ["non_empty"],
      rubric: ["Preserves user intent."],
    })),
    results: [],
    knowledge: {
      packVersion: "2026.07.24",
      ruleIds: ["openai.instructions"],
      sourceVersions: {
        "openai-model-guidance": "fixture-hash",
      },
    },
    verification: "compiled",
    approvalRecords: [],
  };
}

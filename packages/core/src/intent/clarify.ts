import { IntentContractSchema, type IntentContract } from "../contracts.js";

export type ClarificationPath = "answer" | "recommended_assumption" | "fast_draft";

export interface ClarificationQuestion {
  field: string;
  question: string;
  impact: "blocking" | "high" | "safe";
  recommendedAssumption: string;
  paths: readonly [
    { id: "answer"; label: string },
    { id: "recommended_assumption"; label: string },
    { id: "fast_draft"; label: string },
  ];
}

const IMPACT_SCORE = {
  blocking: 300,
  high: 200,
  safe: 100,
} as const;

const FIELD_SCORE: Readonly<Record<string, number>> = {
  objective: 90,
  deliverables: 80,
  successCriteria: 70,
  audience: 60,
  evidenceRequirements: 50,
  "inputs.product": 85,
  "inputs.assets": 65,
  "preferences.duration": 55,
  "preferences.distribution": 50,
  "outputContract.format": 40,
};

function cloneIntent(intent: IntentContract): IntentContract {
  return IntentContractSchema.parse(intent);
}

function rankedAmbiguity(intent: IntentContract): IntentContract["unresolvedAmbiguity"] {
  return intent.unresolvedAmbiguity
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const scoreLeft = IMPACT_SCORE[left.item.impact] + (FIELD_SCORE[left.item.field] ?? 0);
      const scoreRight = IMPACT_SCORE[right.item.impact] + (FIELD_SCORE[right.item.field] ?? 0);
      return scoreRight - scoreLeft || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function selectNextQuestion(intent: IntentContract): ClarificationQuestion | undefined {
  const next = rankedAmbiguity(intent)[0];
  if (!next) {
    return undefined;
  }
  return {
    ...next,
    paths: [
      { id: "answer", label: "Answer this question" },
      { id: "recommended_assumption", label: "Accept the recommended assumption" },
      { id: "fast_draft", label: "Apply all safe defaults and draft now" },
    ],
  };
}

function replaceField(intent: IntentContract, field: string, value: string): void {
  const values = [value.trim()].filter(Boolean);
  const appendUnique = (current: readonly string[], additions: readonly string[]): string[] => [
    ...new Set([...current, ...additions]),
  ];
  switch (field) {
    case "objective":
      intent.objective = value.trim();
      break;
    case "audience":
      intent.audience = values;
      break;
    case "deliverables":
      intent.deliverables = values;
      break;
    case "successCriteria":
      intent.successCriteria = values;
      break;
    case "evidenceRequirements":
      intent.evidenceRequirements = values;
      break;
    case "inputs":
      intent.inputs = values;
      break;
    case "preferences":
      intent.preferences = values;
      break;
    case "outputContract.format":
      intent.outputContract.format = value.trim();
      break;
    default:
      if (field.startsWith("inputs.")) {
        intent.inputs = appendUnique(intent.inputs, values);
        break;
      }
      if (field.startsWith("preferences.")) {
        intent.preferences = appendUnique(intent.preferences, values);
        break;
      }
      throw new Error(`Clarification field "${field}" is not supported.`);
  }
}

export function answerClarification(
  source: IntentContract,
  field: string,
  answer: string,
): IntentContract {
  if (!answer.trim()) {
    throw new Error("A clarification answer cannot be empty.");
  }
  const intent = cloneIntent(source);
  const pending = intent.unresolvedAmbiguity.find((item) => item.field === field);
  if (!pending) {
    throw new Error(`No unresolved ambiguity exists for "${field}".`);
  }
  replaceField(intent, field, answer);
  intent.unresolvedAmbiguity = intent.unresolvedAmbiguity.filter((item) => item.field !== field);
  return IntentContractSchema.parse(intent);
}

export function acceptRecommendedAssumption(
  source: IntentContract,
  field: string,
): IntentContract {
  const pending = source.unresolvedAmbiguity.find((item) => item.field === field);
  if (!pending) {
    throw new Error(`No unresolved ambiguity exists for "${field}".`);
  }
  const intent = answerClarification(source, field, pending.recommendedAssumption);
  intent.assumptions = [
    ...intent.assumptions,
    `${field}: ${pending.recommendedAssumption}`,
  ];
  return IntentContractSchema.parse(intent);
}

/**
 * Resolves every remaining ambiguity using visible, recorded defaults. This is
 * the explicit escape hatch for users who prefer speed over more questions.
 */
export function createFastDraft(source: IntentContract): IntentContract {
  let intent = cloneIntent(source);
  for (const pending of rankedAmbiguity(intent)) {
    intent = acceptRecommendedAssumption(intent, pending.field);
  }
  return intent;
}

export function hasBlockingAmbiguity(intent: IntentContract): boolean {
  return intent.unresolvedAmbiguity.some((item) => item.impact === "blocking");
}

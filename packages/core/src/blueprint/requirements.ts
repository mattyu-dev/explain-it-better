import type { IntentContract } from "../contracts.js";

/**
 * Prompt-relevant capabilities inferred from a human demand. These describe
 * what the eventual answer may need, never what EIB itself may execute.
 */
export interface PromptRequirements {
  retrieval: boolean;
  structuredOutput: boolean;
  image: boolean;
  video: boolean;
  reasons: string[];
}

function searchableDemand(demand: IntentContract): string {
  return [
    demand.objective,
    ...demand.deliverables,
    ...demand.inputs,
    ...demand.constraints,
    ...demand.preferences,
    ...demand.evidenceRequirements,
    ...demand.context.map((item) => item.summary),
    demand.outputContract.format,
  ].join("\n");
}

export function analyzeTaskRequirements(demand: IntentContract): PromptRequirements {
  const text = searchableDemand(demand);
  const retrieval = demand.evidenceRequirements.length > 0 ||
    /\b(?:research|retrieve|browse|current|latest|citations?|evidence|official sources?)\b/iu.test(text);
  const image = /\b(?:images?|photos?|screenshots?|vision|diagrams?)\b/iu.test(text);
  const video = /\b(?:videos?|footage|films?|animations?)\b/iu.test(text);
  const structuredOutput = demand.outputContract.schema !== undefined ||
    /\b(?:json|jsonl|csv|xml|schema)\b/iu.test(demand.outputContract.format);
  const reasons: string[] = [];
  if (retrieval) reasons.push("The demand calls for current or source-backed information.");
  if (structuredOutput) reasons.push("The output contract requires machine-checkable structure.");
  if (image) reasons.push("The demand references image input or output.");
  if (video) reasons.push("The demand references video input or output.");
  return { retrieval, structuredOutput, image, video, reasons };
}

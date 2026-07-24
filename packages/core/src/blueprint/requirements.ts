import type { IntentContract } from "../contracts.js";

export interface TaskRequirements {
  tools: boolean;
  retrieval: boolean;
  structuredOutput: boolean;
  workflow: boolean;
  subagents: boolean;
  memory: boolean;
  humanApproval: boolean;
  filesystemAccess: "none" | "read_only" | "workspace_write";
  networkAccess: "none" | "read_only" | "full";
  image: boolean;
  video: boolean;
  reasons: string[];
}

function searchableIntent(intent: IntentContract): string {
  return [
    intent.objective,
    ...intent.deliverables,
    ...intent.inputs,
    ...intent.constraints,
    ...intent.preferences,
    ...intent.evidenceRequirements,
    ...intent.context.map((item) => item.summary),
    intent.outputContract.format,
  ].join("\n");
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function analyzeTaskRequirements(intent: IntentContract): TaskRequirements {
  const text = searchableIntent(intent);
  const explicitlyQuotedAdversarialAction = matches(
    text,
    /\b(?:document|context|content|message|text)\b[^.\n]{0,180}\b(?:publish|send|purchase|pay|deploy|upload|post|submit)\b[^.\n]{0,180}\b(?:quoted data|not an instruction|do not follow|must not follow|untrusted)\b/iu,
  );
  const externalWrite =
    !explicitlyQuotedAdversarialAction &&
    matches(
      text,
      /\b(?:publish|send|purchase|pay|deploy|delete remotely|overwrite remotely|upload|post|submit|external action|production release)\b/iu,
    );
  const retrieval =
    intent.evidenceRequirements.length > 0 ||
    matches(
      text,
      /\b(?:research|retrieve|browse|current|latest|citations?|evidence|official sources?)\b/iu,
    );
  const image = matches(text, /\b(?:images?|photos?|screenshots?|vision|diagrams?)\b/iu);
  const video = matches(text, /\b(?:videos?|footage|films?|animations?)\b/iu);
  const structuredOutput =
    intent.outputContract.schema !== undefined ||
    matches(intent.outputContract.format, /\b(?:json|jsonl|csv|xml|schema)\b/iu);
  const humanApproval =
    intent.risk === "high" ||
    intent.risk === "critical" ||
    externalWrite;
  const memory = matches(
    text,
    /\b(?:remember|memory|across sessions|recurring|long[- ]running|ongoing)\b/iu,
  );
  const workflow =
    intent.deliverables.length > 1 ||
    matches(text, /\b(?:workflow|pipeline|end-to-end|multi-step|first.+then|implement and test)\b/isu);
  const delegationRequested = matches(
    text,
    /\b(?:sub-?agents?|delegate|delegated|delegation|parallel(?:ize|ise|ized|ised)?|in parallel|concurrently|specialists?|multiple agents?|agent team|best agents?)\b/iu,
  );
  const delegationExcluded = matches(
    [text, ...intent.exclusions].join("\n"),
    /\b(?:no|without|do not use|don't use|avoid)\s+(?:sub-?agents?|delegation|parallel(?:ism| work)?|multiple agents?)\b|\b(?:single agent|sequential only)\b/iu,
  );
  const subagents =
    (delegationRequested && !delegationExcluded) ||
    (workflow && retrieval && intent.risk !== "critical" && !delegationExcluded);
  const filesystemMarker =
    /\b(?:repository|repo|codebase|workspace|files?|folders?|director(?:y|ies)|paths?|local project|assets?|screenshots?|documents?|source code)\b/iu;
  const filesystemWrite =
    matches(
      text,
      /\b(?:edit|modify|write|create|generate|save|install|implement|patch|update|delete|overwrite|render|export)\b[^.\n]{0,100}\b(?:repository|repo|codebase|workspace|files?|folders?|director(?:y|ies)|local project|source code)\b/iu,
    ) ||
    matches(
      text,
      /\b(?:repository|repo|codebase|workspace|files?|folders?|director(?:y|ies)|local project|source code)\b[^.\n]{0,100}\b(?:edit|modify|write|create|generate|save|install|implement|patch|update|delete|overwrite|render|export)\b/iu,
    ) ||
    matches(
      text,
      /\b(?:create|generate|produce|render|export)\b[^.\n]{0,80}\b(?:video|audio|image|presentation|slide deck|document|pdf)\b/iu,
    ) ||
    matches(
      text,
      /\b(?:build|implement|create|write|generate)\b[^.\n]{0,80}\b(?:app|application|cli|tool|code|software|website|package|module|service)\b/iu,
    );
  const filesystemRead = filesystemWrite || matches(text, filesystemMarker);
  const networkRead =
    externalWrite ||
    retrieval ||
    matches(text, /\b(?:https?:\/\/|url|download|fetch|browser|online|internet|remote api)\b/iu);
  const filesystemAccess = filesystemWrite
    ? "workspace_write"
    : filesystemRead
      ? "read_only"
      : "none";
  const networkAccess = externalWrite ? "full" : networkRead ? "read_only" : "none";
  const tools =
    retrieval ||
    image ||
    video ||
    humanApproval ||
    filesystemAccess !== "none" ||
    networkAccess !== "none" ||
    matches(
      text,
      /\b(?:tool|api|database|repository|files?|browser|terminal|install|compile|execute|run)\b/iu,
    );

  const reasons: string[] = [];
  if (retrieval) reasons.push("Current or source-backed information requires retrieval.");
  if (structuredOutput) reasons.push("The output contract requires machine-checkable structure.");
  if (workflow) reasons.push("The task contains multiple deliverables or dependent stages.");
  if (subagents) reasons.push("Independent specialist work can be separated safely.");
  if (memory) reasons.push("The brief explicitly requires continuity over time.");
  if (humanApproval) reasons.push("Consequential actions require a human approval boundary.");
  if (filesystemAccess !== "none") {
    reasons.push(`The task requires ${filesystemAccess.replace("_", " ")} filesystem access.`);
  }
  if (networkAccess !== "none") {
    reasons.push(`The task requires ${networkAccess.replace("_", " ")} network access.`);
  }
  if (image) reasons.push("The task references image input or output.");
  if (video) reasons.push("The task references video input or output.");

  return {
    tools,
    retrieval,
    structuredOutput,
    workflow,
    subagents,
    memory,
    humanApproval,
    filesystemAccess,
    networkAccess,
    image,
    video,
    reasons,
  };
}

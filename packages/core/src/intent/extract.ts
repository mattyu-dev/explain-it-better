import { IntentContractSchema, type IntentContract } from "../contracts.js";

const CONTRACT_VERSION = "1.0.0" as const;

export interface IntentHints {
  motivation?: string;
  audience?: string[];
  deliverables?: string[];
  inputs?: string[];
  constraints?: string[];
  preferences?: string[];
  exclusions?: string[];
  successCriteria?: string[];
  evidenceRequirements?: string[];
  outputFormat?: string;
  outputSchema?: IntentContract["outputContract"]["schema"];
  language?: string;
  verbosity?: "concise" | "balanced" | "detailed";
  risk?: IntentContract["risk"];
}

const SECTION_ALIASES: Readonly<Record<string, string>> = {
  audience: "audience",
  "for": "audience",
  deliverable: "deliverables",
  deliverables: "deliverables",
  inputs: "inputs",
  context: "inputs",
  constraints: "constraints",
  requirements: "constraints",
  preferences: "preferences",
  exclusions: "exclusions",
  "do not": "exclusions",
  success: "successCriteria",
  "success criteria": "successCriteria",
  evidence: "evidenceRequirements",
  sources: "evidenceRequirements",
  motivation: "motivation",
  purpose: "motivation",
  product: "product",
  assets: "assets",
  "source assets": "assets",
  output: "outputFormat",
  "output format": "outputFormat",
  format: "outputFormat",
  "response format": "outputFormat",
  duration: "duration",
  distribution: "distribution",
  channel: "distribution",
  channels: "distribution",
  platform: "distribution",
  platforms: "distribution",
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function hasConjunctionAfterComma(value: string, index: number): boolean {
  let cursor = index + 1;
  if (!isWhitespace(value[cursor])) return false;
  while (isWhitespace(value[cursor])) cursor += 1;
  const wordStart = cursor;
  while (/[A-Za-z]/u.test(value[cursor] ?? "")) cursor += 1;
  const word = value.slice(wordStart, cursor).toLowerCase();
  return (word === "and" || word === "or") && !/[A-Za-z]/u.test(value[cursor] ?? "");
}

function withoutListMarker(value: string): string {
  const trimmed = value.trimStart();
  return trimmed.startsWith("-") || trimmed.startsWith("*") ? trimmed.slice(1).trimStart() : trimmed;
}

function splitList(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const delimiter = character === ";" || character === "\n" || character === "\u2022" ||
      (character === "," && !hasConjunctionAfterComma(value, index));
    if (delimiter) {
      parts.push(withoutListMarker(value.slice(start, index)));
      start = index + 1;
    }
  }
  parts.push(withoutListMarker(value.slice(start)));
  return unique(parts);
}

function isHeadingName(value: string): boolean {
  if (value.length === 0 || value.length > 41 || !/[A-Za-z]/u.test(value[0] ?? "")) return false;
  return [...value].every((character) => /[A-Za-z /-]/u.test(character));
}

function sectionHeader(line: string): { readonly name: string; readonly value: string } | undefined {
  let start = 0;
  if (line.startsWith("-") || line.startsWith("*")) {
    start += 1;
    while (isWhitespace(line[start])) start += 1;
  }
  const colon = line.indexOf(":", start);
  if (colon === -1) return undefined;
  const name = line.slice(start, colon).trim();
  return isHeadingName(name) ? { name, value: line.slice(colon + 1).trim() } : undefined;
}

function parseSections(brief: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let activeSection: string | undefined;
  let acceptsPlainContinuation = false;

  const append = (name: string, value: string): void => {
    const values = splitList(value);
    if (values.length > 0) {
      sections.set(name, [...(sections.get(name) ?? []), ...values]);
    }
  };

  for (const rawLine of brief.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      activeSection = undefined;
      acceptsPlainContinuation = false;
      continue;
    }

    // Support both compact sections (`Deliverables: checklist`) and ordinary
    // Markdown sections (`Deliverables:` followed by one or more list items).
    // We only recognise known headings, so prose such as "Note: ..." cannot
    // accidentally become a structured requirement.
    const header = sectionHeader(line);
    const name = header ? SECTION_ALIASES[header.name.toLowerCase().replace(/\s+/gu, " ")] : undefined;
    if (name) {
      activeSection = name;
      const rawValue = header?.value;
      acceptsPlainContinuation = !rawValue;
      if (rawValue) {
        append(name, rawValue);
      }
      continue;
    }

    if (header) {
      // An unrecognised heading starts a new prose section. Do not leak it
      // into the preceding structured field.
      activeSection = undefined;
      acceptsPlainContinuation = false;
      continue;
    }

    if (
      activeSection &&
      (acceptsPlainContinuation || /^\s+\S/u.test(rawLine) || /^[-*]\s+/u.test(line))
    ) {
      // A section may be expressed as a bullet list or as a wrapped paragraph.
      // Keep the whole value: downstream prompt generation must not silently
      // truncate a user's requested deliverable.
      append(activeSection, line.replace(/^[-*]\s*/, ""));
    }
  }
  return sections;
}

function inferObjective(brief: string): string {
  const withoutSections = brief
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^[a-z][a-z ]{1,30}\s*:/iu.test(line));
  return withoutSections ?? brief.trim();
}

function inferDeliverables(brief: string): string[] {
  // A common project request asks for both a review and the practical route
  // forward without using an explicit "return a …" clause.  Preserve that
  // two-part artifact rather than falling through to a vague fast-draft
  // placeholder.  The follow-up qualifier is optional so an architecture
  // review remains a concrete deliverable on its own.
  const reviewMatch =
    /\b(?:review|audit|assess|inspect|evaluate)\s+(?:the\s+)?(architecture|codebase|project|system|implementation)\b/iu.exec(
      brief,
    );
  if (reviewMatch?.[1]) {
    const nextSteps =
      /\b(?:what are|identify|recommend|outline|provide)\s+(?:the\s+)?next steps?(?:\s+(?:to|for)\s+([^.!?\n]+))?/iu.exec(
        brief,
      );
    const reviewed = reviewMatch[1].toLowerCase();
    return [
      nextSteps === null
        ? `${reviewed} review`
        : `${reviewed} review and prioritized next steps${
            nextSteps[1] ? ` to ${nextSteps[1].trim()}` : ""
          }`,
    ];
  }

  // Requests such as "make it better" describe a goal, not an artifact. Give
  // an explicit return/provide/deliver clause priority when it exists, then
  // fall back to an authoring verb. Values deliberately run to the sentence or
  // line boundary rather than an arbitrary character limit.
  const patterns = [
    /\b(?:return|provide|deliver|present)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+)?([^.!?\n]{2,})/iu,
    /\b(?:create|build|write|produce|design|generate|implement|draft|analy[sz]e|make(?!\s+(?:it|this|that)\b))\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+)?([^.!?\n]{2,})/iu,
  ];
  for (const pattern of patterns) {
    const value = pattern
      .exec(brief)?.[1]
      ?.replace(/(?:[;,]\s*(?:but\s+)?)\b(?:do not|don't|never|avoid|exclude)\b.*$/iu, "")
      .trim();
    if (value) {
      return [value];
    }
  }
  return [];
}

function inferExclusions(brief: string): string[] {
  const exclusions: string[] = [];
  let start = 0;
  const addCandidate = (end: number): void => {
    const candidate = brief.slice(start, end).trim();
    const normalized = candidate.toLowerCase();
    if (["do not", "don't", "never", "avoid", "exclude"].some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `),
    )) {
      exclusions.push(candidate);
    }
  };
  for (let index = 0; index < brief.length; index += 1) {
    if (brief[index] === "." || brief[index] === ";" || brief[index] === "\n") {
      addCandidate(index);
      start = index + 1;
    }
  }
  addCandidate(brief.length);
  return unique(exclusions);
}

function inferLanguage(brief: string): string {
  const requested =
    /\b(?:in|language\s*[:=])\s+(English|French|Spanish|German|Italian|Portuguese|Japanese|Korean|Chinese)\b/iu.exec(
      brief,
    )?.[1];
  if (requested) {
    return requested;
  }
  if (/[àâçéèêëîïôûùüÿœ]/iu.test(brief)) {
    return "French";
  }
  return "English";
}

function inferFormat(brief: string): string | undefined {
  const formats = "JSONL|JSON|Markdown|HTML|CSV|table|report|email|code|plan|presentation";
  const explicitFormat = new RegExp(
    `\\b(?:output|response|answer)(?:\\s+format)?\\s*(?::|as|in)\\s*(?:an?\\s+)?(?:valid\\s+)?(${formats})\\b|\\bformat(?:ted)?\\s+(?:as|in)\\s+(?:an?\\s+)?(?:valid\\s+)?(${formats})\\b|\\b(?:return|respond|reply|output|provide|present|deliver)\\s+(?:it\\s+)?(?:as|in|with)\\s+(?:an?\\s+)?(?:valid\\s+)?(${formats})\\b`,
    "iu",
  );
  const explicitMatch = explicitFormat.exec(brief);
  const explicitValue = explicitMatch?.slice(1).find((value) => value !== undefined);
  if (explicitValue) {
    return explicitValue;
  }

  // A format can also be explicit in the direct object of an authoring verb.
  // This intentionally does not scan arbitrary mentions (for example,
  // "inspect the code, docs, and tests" is not a request for code output).
  const artifactMatch = new RegExp(
    `\\b(?:return|provide|deliver|present|create|build|write|produce|design|generate|implement|draft|make)\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+)?(?:prioritized\\s+|detailed\\s+|concise\\s+|complete\\s+|actionable\\s+|implementation\\s+|executive\\s+)*(${formats})\\b`,
    "iu",
  ).exec(brief);
  return artifactMatch?.[1];
}

function inferRisk(brief: string): IntentContract["risk"] {
  if (/\b(?:medical|legal|financial advice|production deploy|delete|payment|credential|secret)\b/iu.test(brief)) {
    return "high";
  }
  if (/\b(?:publish|send|install|modify|purchase|external action|write files?)\b/iu.test(brief)) {
    return "medium";
  }
  return "low";
}

function isLaunchVideoBrief(brief: string): boolean {
  return /\b(?:(?:product|app|brand)\s+launch\s+video|launch\s+video|video\s+for\s+(?:a|the|my|our)\s+(?:product|app|brand))\b/iu.test(
    brief,
  );
}

function hasLaunchVideoProduct(
  brief: string,
  sections: ReadonlyMap<string, string[]>,
  inputs: readonly string[],
): boolean {
  if (
    (sections.get("product")?.length ?? 0) > 0 ||
    inputs.some((value) => /^Product\s*:/iu.test(value))
  ) {
    return true;
  }
  const namedProduct =
    /\b(?:launch\s+video|product\s+video)\s+(?:for|about)\s+([^.!?\n]{2,80})/iu.exec(brief)?.[1];
  return (
    /https?:\/\/\S+/iu.test(brief) ||
    (namedProduct !== undefined &&
      !/^(?:a|the|my|our)\s+(?:product|app|brand)\b/iu.test(namedProduct.trim()))
  );
}

function hasLaunchVideoDuration(
  brief: string,
  sections: ReadonlyMap<string, string[]>,
  preferences: readonly string[],
): boolean {
  return (
    (sections.get("duration")?.length ?? 0) > 0 ||
    /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:s|sec(?:ond)?s?|m|min(?:ute)?s?)\b/iu.test(brief) ||
    preferences.some((value) =>
      /\b(?:duration|length|\d+\s*(?:s|sec(?:ond)?s?|m|min(?:ute)?s?))\b/iu.test(value),
    )
  );
}

function hasLaunchVideoDistribution(
  brief: string,
  sections: ReadonlyMap<string, string[]>,
  preferences: readonly string[],
): boolean {
  const distributionText = [brief, ...preferences].join("\n");
  return (
    (sections.get("distribution")?.length ?? 0) > 0 ||
    /\b(?:tiktok|instagram|reels?|youtube|shorts?|linkedin|x\/twitter|twitter|product hunt|app store|play store|landing page|website|paid ads?|organic social|presentation|broadcast)\b/iu.test(
      distributionText,
    )
  );
}

function hasLaunchVideoAssets(
  brief: string,
  sections: ReadonlyMap<string, string[]>,
  inputs: readonly string[],
): boolean {
  const assetText = [brief, ...inputs].join("\n");
  return (
    (sections.get("assets")?.length ?? 0) > 0 ||
    /https?:\/\/\S+|\b(?:assets?|logo|brand kit|screenshots?|screen recordings?|footage|product url|website url|demo|voice-?over|music|images?|photos?)\b/iu.test(
      assetText,
    )
  );
}

function ambiguity(
  field: string,
  question: string,
  impact: "blocking" | "high" | "safe",
  recommendedAssumption: string,
): IntentContract["unresolvedAmbiguity"][number] {
  return { field, question, impact, recommendedAssumption };
}

/**
 * Creates a schema-valid first-pass contract without pretending that missing
 * details were supplied. Every placeholder is paired with unresolved ambiguity.
 */
export function extractIntent(brief: string, hints: IntentHints = {}): IntentContract {
  const normalizedBrief = brief.trim();
  if (!normalizedBrief) {
    throw new Error("A non-empty brief is required to extract intent.");
  }

  const sections = parseSections(normalizedBrief);
  const sectionInputs = [
    ...(sections.get("inputs") ?? []),
    ...(sections.get("product") ?? []).map((value) => `Product: ${value}`),
    ...(sections.get("assets") ?? []).map((value) => `Assets: ${value}`),
  ];
  const sectionPreferences = [
    ...(sections.get("preferences") ?? []),
    ...(sections.get("duration") ?? []).map((value) => `Duration: ${value}`),
    ...(sections.get("distribution") ?? []).map((value) => `Distribution: ${value}`),
  ];
  const explicitAudience = unique(hints.audience ?? sections.get("audience") ?? []);
  const explicitDeliverables = unique(
    hints.deliverables ?? sections.get("deliverables") ?? inferDeliverables(normalizedBrief),
  );
  const explicitSuccess = unique(hints.successCriteria ?? sections.get("successCriteria") ?? []);
  const explicitEvidence = unique(
    hints.evidenceRequirements ?? sections.get("evidenceRequirements") ?? [],
  );
  const explicitInputs = unique(hints.inputs ?? sectionInputs);
  const explicitPreferences = unique(hints.preferences ?? sectionPreferences);
  const explicitExclusions = unique(hints.exclusions ?? sections.get("exclusions") ?? inferExclusions(normalizedBrief));
  const explicitFormat =
    hints.outputFormat ??
    (hints.outputSchema ? "JSON" : sections.get("outputFormat")?.join("; ") ?? inferFormat(normalizedBrief));
  const unresolved: IntentContract["unresolvedAmbiguity"] = [];

  if (explicitAudience.length === 0) {
    unresolved.push(
      ambiguity(
        "audience",
        "Who will use or judge the result?",
        "high",
        "The requester is the primary audience.",
      ),
    );
  }
  if (explicitDeliverables.length === 0) {
    unresolved.push(
      ambiguity(
        "deliverables",
        "What concrete artifact should be delivered?",
        "blocking",
        "Deliver one complete artifact that directly satisfies the objective.",
      ),
    );
  }
  if (explicitSuccess.length === 0) {
    unresolved.push(
      ambiguity(
        "successCriteria",
        "What observable result would make this successful?",
        "high",
        "The result is complete, accurate, usable, and satisfies every explicit constraint.",
      ),
    );
  }
  if (!explicitFormat) {
    unresolved.push(
      ambiguity(
        "outputContract.format",
        "What output format should the final artifact use?",
        "safe",
        "Markdown",
      ),
    );
  }
  if (
    /\b(?:research|compare|verify|current|latest|citation|evidence|official sources?)\b/iu.test(
      normalizedBrief,
    ) &&
    explicitEvidence.length === 0
  ) {
    unresolved.push(
      ambiguity(
        "evidenceRequirements",
        "What evidence or source standard should support the result?",
        "high",
        "Use current primary sources and cite material factual claims.",
      ),
    );
  }
  if (isLaunchVideoBrief(normalizedBrief)) {
    if (!hasLaunchVideoProduct(normalizedBrief, sections, explicitInputs)) {
      unresolved.push(
        ambiguity(
          "inputs.product",
          "Which product is the video launching, and what source should define its positioning?",
          "blocking",
          "Use the supplied product description or URL; if neither exists, produce a clearly marked product-placeholder template.",
        ),
      );
    }
    if (!hasLaunchVideoDuration(normalizedBrief, sections, explicitPreferences)) {
      unresolved.push(
        ambiguity(
          "preferences.duration",
          "What target duration should the launch video have?",
          "high",
          "Target 45 seconds, with a concise hook, product proof, and call to action.",
        ),
      );
    }
    if (!hasLaunchVideoDistribution(normalizedBrief, sections, explicitPreferences)) {
      unresolved.push(
        ambiguity(
          "preferences.distribution",
          "Where will the launch video be distributed?",
          "high",
          "Optimize a 16:9 master for a product website and YouTube, while keeping safe crops for social reuse.",
        ),
      );
    }
    if (!hasLaunchVideoAssets(normalizedBrief, sections, explicitInputs)) {
      unresolved.push(
        ambiguity(
          "inputs.assets",
          "Which product, brand, screen-recording, voice-over, or music assets are available?",
          "high",
          "Use supplied assets only; otherwise use clearly labeled placeholders and do not invent product claims.",
        ),
      );
    }
  }

  return IntentContractSchema.parse({
    version: CONTRACT_VERSION,
    objective: inferObjective(normalizedBrief),
    motivation:
      hints.motivation ??
      sections.get("motivation")?.join("; ") ??
      "Not specified",
    audience: explicitAudience.length > 0 ? explicitAudience : ["Unspecified audience"],
    deliverables:
      explicitDeliverables.length > 0 ? explicitDeliverables : ["Unspecified deliverable"],
    inputs: explicitInputs,
    context: [
      {
        id: "original-brief",
        source: "user brief",
        trust: "user",
        summary: normalizedBrief,
      },
    ],
    constraints: unique(hints.constraints ?? sections.get("constraints") ?? []),
    preferences: explicitPreferences,
    exclusions: explicitExclusions,
    assumptions: [],
    successCriteria:
      explicitSuccess.length > 0 ? explicitSuccess : ["Success criteria not yet specified"],
    evidenceRequirements: explicitEvidence,
    outputContract: {
      format: explicitFormat ?? "Unspecified format",
      ...(hints.outputSchema ? { schema: hints.outputSchema } : {}),
      language: hints.language ?? inferLanguage(normalizedBrief),
      verbosity: hints.verbosity ?? "balanced",
    },
    risk: hints.risk ?? inferRisk(normalizedBrief),
    unresolvedAmbiguity: unresolved,
  });
}

/** Public intent-compiler name used by the CLI and other local clients. */
export function analyzeBrief(brief: string, options: IntentHints = {}): IntentContract {
  return extractIntent(brief, options);
}

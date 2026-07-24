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

function splitList(value: string): string[] {
  return unique(
    value
      .split(/\s*(?:;|,(?!\s+(?:and|or)\b)|\n|\u2022)\s*/u)
      .map((item) => item.replace(/^[-*]\s*/, "").trim()),
  );
}

function parseSections(brief: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  for (const rawLine of brief.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(?:[-*]\s*)?([a-z][a-z ]{1,30})\s*:\s*(.+)$/iu.exec(line);
    if (!match) {
      continue;
    }

    const rawName = match[1];
    const rawValue = match[2];
    if (!rawName || !rawValue) {
      continue;
    }
    const name = SECTION_ALIASES[rawName.toLowerCase()];
    if (!name) {
      continue;
    }
    sections.set(name, [...(sections.get(name) ?? []), ...splitList(rawValue)]);
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
  const match =
    /\b(?:create|build|write|produce|design|generate|implement|make|draft|analy[sz]e)\s+(?:me\s+|an?\s+|the\s+)?([^.!?\n]{2,100})/iu.exec(
      brief,
    );
  const value = match?.[1]?.trim();
  return value ? [value] : [];
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
  const formats = [
    "JSON",
    "JSONL",
    "Markdown",
    "HTML",
    "CSV",
    "table",
    "report",
    "email",
    "code",
    "plan",
    "presentation",
  ];
  return formats.find((format) =>
    new RegExp(`\\b${format.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(brief),
  );
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
  const explicitFormat =
    hints.outputFormat ?? (hints.outputSchema ? "JSON" : inferFormat(normalizedBrief));
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
    exclusions: unique(hints.exclusions ?? sections.get("exclusions") ?? []),
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

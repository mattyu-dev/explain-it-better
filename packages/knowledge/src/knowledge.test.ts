import { describe, expect, it } from "vitest";
import { TargetProfileSchema } from "@eib/core";
import {
  KNOWLEDGE_PACK_VERSION,
  checkKnowledgeSources,
  getRulesForProfile,
  getTargetProfile,
  knowledgeRules,
  listTargetProfiles,
  ruleConformanceRegistry,
  runKnowledgeRuleConformance,
  runRuleConformance,
  sourceManifest,
  stageKnowledgeUpdates,
  targetProfiles,
  validateKnowledgePack,
  validateTargetConfiguration,
  type KnowledgeFetcher,
} from "./index.js";

describe("reviewed knowledge pack", () => {
  it("validates every built-in source, profile, rule, and cross-reference", () => {
    const report = validateKnowledgePack();

    expect(report).toEqual({
      valid: true,
      errors: [],
      counts: {
        sources: sourceManifest.length,
        profiles: targetProfiles.length,
        rules: knowledgeRules.length,
      },
    });
    expect(
      targetProfiles.every(
        (entry) => TargetProfileSchema.safeParse(entry).success,
      ),
    ).toBe(true);
  });

  it("rejects a rule source omitted from an applicable profile", () => {
    const profile = getTargetProfile("kimi-k3-api");
    const report = validateKnowledgePack({
      profiles: [
        ...targetProfiles.filter((entry) => entry.id !== profile.id),
        {
          ...profile,
          sourceIds: profile.sourceIds.filter(
            (sourceId) => sourceId !== "kimi-k3-guide",
          ),
        },
      ],
    });

    expect(report.valid).toBe(false);
    expect(report.errors).toContain(
      "Rule kimi-k3-always-thinking source kimi-k3-guide is not declared by applicable profile kimi-k3-api",
    );
  });

  it("returns an invalid report for malformed override entries", () => {
    const report = validateKnowledgePack({
      profiles: [
        {
          id: "invalid-profile",
        } as never,
      ],
    });

    expect(report.valid).toBe(false);
    expect(report.errors).not.toEqual([]);
  });

  it("includes every required provider, Kimi split, Kimi Code, and Hermes without the excluded provider", () => {
    const providers = new Set(targetProfiles.map((entry) => entry.provider));
    expect(providers).toEqual(
      new Set([
        "openai",
        "anthropic",
        "google",
        "xai",
        "deepseek",
        "meta",
        "mistral",
        "kimi",
        "hermes",
      ]),
    );
    for (const model of ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"]) {
      expect(
        targetProfiles.some(
          (entry) =>
            entry.model === model && entry.deployment.mode === "hosted",
        ),
      ).toBe(true);
      expect(
        targetProfiles.some(
          (entry) =>
            entry.model === model &&
            entry.deployment.mode === "self_hosted",
        ),
      ).toBe(true);
    }
    expect(getTargetProfile("kimi-code-cli").availability).toBe("target_only");
    expect(getTargetProfile("hermes-agent").availability).toBe("target_only");
  });

  it("looks up and filters profiles and resolves only applicable rules", () => {
    expect(getTargetProfile("kimi-k3-api").contextWindow).toBe(1_048_576);
    expect(
      listTargetProfiles({ provider: "kimi", deploymentMode: "self_hosted" }),
    ).toHaveLength(3);
    const ruleIds = getRulesForProfile("kimi-k3-api").map((entry) => entry.id);
    expect(ruleIds).toContain("kimi-k3-always-thinking");
    expect(ruleIds).toContain("kimi-k3-dynamic-tools");
    expect(ruleIds).not.toContain("kimi-k2-6-thinking-instant");
  });

  it("pins the refreshed xAI catalog and canonical Mistral markdown guide", () => {
    const xai = sourceManifest.find((source) => source.id === "xai-models");
    const mistral = sourceManifest.find(
      (source) => source.id === "mistral-prompting",
    );

    expect(xai).toMatchObject({
      url: "https://docs.x.ai/developers/models/grok-4.5.md",
      driftStrategy: "full_hash",
    });
    expect(xai?.expectedSignals).toEqual(
      expect.arrayContaining(["grok-4.5", "Function calling", "Structured outputs"]),
    );
    expect(mistral).toMatchObject({
      url: "https://docs.mistral.ai/studio-api/conversations/chat-completion/prompting.md",
      driftStrategy: "full_hash",
    });
    expect(mistral?.expectedSignals).toEqual(
      expect.arrayContaining([
        "System Prompt",
        "Structured Outputs",
        "Avoid Contradictions",
        "Do Not Generate Too Many Tokens",
      ]),
    );
  });

  it("executes a registered conformance handler for every applicable rule/profile pair", () => {
    const report = runKnowledgeRuleConformance();
    const expectedPairs = targetProfiles.reduce(
      (total, profile) => total + getRulesForProfile(profile).length,
      0,
    );

    expect(report.valid).toBe(true);
    expect(report.missingHandlerRuleIds).toEqual([]);
    expect(report.unappliedRuleIds).toEqual([]);
    expect(report.results).toHaveLength(expectedPairs);
    expect(report.results.every((result) => result.passed)).toBe(true);
    expect(report.results.every((result) => result.evidence.length > 0)).toBe(
      true,
    );
    expect(Object.keys(ruleConformanceRegistry).sort()).toEqual(
      knowledgeRules.map((rule) => rule.id).sort(),
    );
  });

  it("reports a rule-level executable failure when profile guarantees regress", () => {
    const profile = getTargetProfile("kimi-k3-api");
    const weakened = {
      ...profile,
      toolCapabilities: {
        ...profile.toolCapabilities,
        dynamicLoading: false,
      },
    };
    const result = runRuleConformance(
      "kimi-k3-dynamic-tools",
      weakened,
      targetProfiles,
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      "kimi-k3-api does not enable dynamic tool loading",
    );
  });
});

describe("target conformance", () => {
  it("has a deliberately incompatible context fixture for every target profile", () => {
    for (const target of targetProfiles) {
      const report = validateTargetConfiguration(target, {
        contextTokens: target.contextWindow + 1,
      });
      expect(report.valid, target.id).toBe(false);
      expect(report.issues.map((entry) => entry.code), target.id).toContain(
        "context_window_exceeded",
      );
    }
  });

  it("fails closed on unsupported capabilities and context overflow", () => {
    const report = validateTargetConfiguration(
      "meta-llama-4-maverick-open-weights",
      {
        roles: ["developer"],
        tools: true,
        structuredOutput: true,
        contextTokens: 2_000_000,
      },
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unsupported_role",
        "unsupported_capability",
        "context_window_exceeded",
      ]),
    );
  });

  it("rejects unknown configuration fields and parameters", () => {
    const report = validateTargetConfiguration("deepseek-chat-api", {
      tools: true,
      undeclaredCapability: true,
      parameters: { temperature: 0.2 },
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["invalid_configuration"]),
    );

    const parameterReport = validateTargetConfiguration("deepseek-chat-api", {
      parameters: { temperature: 0.2 },
    });
    expect(parameterReport.valid).toBe(false);
    expect(parameterReport.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported_parameter",
          path: "parameters.temperature",
        }),
      ]),
    );
  });

  it("enforces Kimi reasoning and fixed sampling rules", () => {
    const invalid = validateTargetConfiguration("kimi-k3-api", {
      reasoningMode: "instant",
      parameters: { temperature: 0.3 },
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unsupported_reasoning_mode",
        "invalid_parameter_value",
      ]),
    );

    const valid = validateTargetConfiguration("kimi-k3-api", {
      reasoningMode: "max",
      tools: true,
      structuredOutput: true,
      image: true,
      video: true,
      promptCaching: true,
      dynamicTools: true,
      strictToolSchemas: true,
      toolChoiceMode: "required",
      contextTokens: 1_000_000,
    });
    expect(valid).toEqual({
      valid: true,
      profileId: "kimi-k3-api",
      issues: [],
    });
  });
});

describe("knowledge drift workflow", () => {
  it("uses required semantic signals for volatile source documents", async () => {
    const fetcher: KnowledgeFetcher = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            "Clear and specific instructions use structured output while Gemini 3.x models keep sampling defaults.",
          ),
      });
    const report = await checkKnowledgeSources({
      fetcher,
      sourceIds: ["google-gemini-prompting"],
      checkedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(report.status).toBe("current");
    expect(report.checks[0]).toMatchObject({
      status: "current",
      driftStrategy: "required_signals",
      hashMatches: false,
      signalsMatch: true,
      decisionBasis: "required_signals",
    });
  });

  it("detects required-signal drift in volatile source documents", async () => {
    const fetcher: KnowledgeFetcher = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            "Clear and specific instructions use structured output.",
          ),
      });
    const report = await checkKnowledgeSources({
      fetcher,
      sourceIds: ["google-gemini-prompting"],
      checkedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(report.status).toBe("drift_detected");
    expect(report.checks[0]).toMatchObject({
      status: "changed",
      driftStrategy: "required_signals",
      hashMatches: false,
      signalsMatch: false,
      missingSignals: ["Gemini 3.x models"],
      decisionBasis: "required_signals",
    });
  });

  it("detects changed reviewed content and stages it without activation", async () => {
    const fetcher: KnowledgeFetcher = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("upstream page changed"),
      });
    const report = await checkKnowledgeSources({
      fetcher,
      sourceIds: ["kimi-k3-guide"],
      checkedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(report.status).toBe("drift_detected");
    expect(report.checks[0]).toMatchObject({
      status: "changed",
      driftStrategy: "full_hash",
      hashMatches: false,
      signalsMatch: false,
      decisionBasis: "full_hash_and_signals",
    });
    const stage = stageKnowledgeUpdates({
      report,
      stagedAt: "2026-07-24T10:01:00.000Z",
    });
    expect(stage).toMatchObject({
      packVersion: KNOWLEDGE_PACK_VERSION,
      activation: "blocked_pending_review",
      changes: [
        {
          sourceId: "kimi-k3-guide",
          reviewStatus: "pending_review",
        },
      ],
    });
  });

  it("reports source failures as incomplete and does not stage them", async () => {
    const fetcher: KnowledgeFetcher = () =>
      Promise.reject(new Error("network unavailable"));
    const report = await checkKnowledgeSources({
      fetcher,
      sourceIds: ["openai-model-guidance"],
      checkedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(report.status).toBe("incomplete");
    expect(report.checks[0]).toMatchObject({
      status: "unreachable",
      hashMatches: null,
      signalsMatch: null,
      decisionBasis: "unreachable",
      error: "network unavailable",
    });
    expect(
      stageKnowledgeUpdates({
        report,
        stagedAt: "2026-07-24T10:01:00.000Z",
      }).changes,
    ).toEqual([]);
  });
});

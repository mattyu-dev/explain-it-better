import {
  KnowledgePackInputSchema,
  KnowledgeTargetProfileSchema,
  TargetConfigurationSchema,
  type ConformanceIssue,
  type ConformanceReport,
  type KnowledgePackInput,
  type KnowledgePackValidationReport,
  type KnowledgeTargetProfile,
  KNOWLEDGE_PACK_VERSION,
} from "./schemas.js";
import { getTargetProfile, targetProfiles } from "./profiles.js";
import { knowledgeRules } from "./rules.js";
import { sourceManifest } from "./sources.js";
import { runKnowledgeRuleConformance } from "./rule-conformance.js";

export interface KnowledgePackOverride {
  readonly version?: string;
  readonly sources?: readonly KnowledgePackInput["sources"][number][];
  readonly profiles?: readonly KnowledgeTargetProfile[];
  readonly rules?: readonly KnowledgePackInput["rules"][number][];
}

function addDuplicateErrors(
  values: readonly { readonly id: string }[],
  kind: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      errors.push(`Duplicate ${kind} id: ${value.id}`);
    }
    seen.add(value.id);
  }
}

export function validateKnowledgePack(
  override: KnowledgePackOverride = {},
): KnowledgePackValidationReport {
  const sources =
    override.sources === undefined
      ? sourceManifest
      : Array.isArray(override.sources)
        ? override.sources
        : [];
  const profiles =
    override.profiles === undefined
      ? targetProfiles
      : Array.isArray(override.profiles)
        ? override.profiles
        : [];
  const rules =
    override.rules === undefined
      ? knowledgeRules
      : Array.isArray(override.rules)
        ? override.rules
        : [];
  const candidate = {
    version: override.version ?? KNOWLEDGE_PACK_VERSION,
    sources: [...sources],
    profiles: [...profiles],
    rules: [...rules],
  };
  const errors: string[] = [];
  const parsed = KnowledgePackInputSchema.safeParse(candidate);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`,
      ),
    );
    return {
      valid: false,
      errors,
      counts: {
        sources: candidate.sources.length,
        profiles: candidate.profiles.length,
        rules: candidate.rules.length,
      },
    };
  }

  const pack = parsed.data;

  addDuplicateErrors(pack.sources, "source", errors);
  addDuplicateErrors(pack.profiles, "profile", errors);
  addDuplicateErrors(pack.rules, "rule", errors);

  const sourcesById = new Map(pack.sources.map((entry) => [entry.id, entry]));
  for (const profile of pack.profiles) {
    for (const sourceId of profile.sourceIds) {
      const source = sourcesById.get(sourceId);
      if (source === undefined) {
        errors.push(`Profile ${profile.id} references unknown source ${sourceId}`);
      } else if (source.provider !== profile.provider) {
        errors.push(
          `Profile ${profile.id} provider does not match source ${sourceId}`,
        );
      }
    }
  }
  for (const rule of pack.rules) {
    const matchingSource = pack.sources.find(
      (entry) =>
        entry.url === rule.sourceUrl &&
        entry.provider === rule.scope.provider,
    );
    if (matchingSource === undefined) {
      errors.push(`Rule ${rule.id} does not reference a reviewed provider source`);
    } else if (matchingSource.contentHash !== rule.sourceHash) {
      errors.push(`Rule ${rule.id} source hash is stale`);
    }
    for (const profile of pack.profiles) {
      const applies =
        rule.scope.provider === profile.provider &&
        rule.scope.surfaces.includes(profile.surface) &&
        (rule.scope.models.includes("*") ||
          rule.scope.models.includes(profile.model));
      if (applies && matchingSource !== undefined && !profile.sourceIds.includes(matchingSource.id)) {
        errors.push(
          `Rule ${rule.id} source ${matchingSource.id} is not declared by applicable profile ${profile.id}`,
        );
      }
    }
  }

  const requiredProviders: KnowledgeTargetProfile["provider"][] = [
    "openai",
    "anthropic",
    "google",
    "xai",
    "deepseek",
    "meta",
    "mistral",
    "kimi",
    "hermes",
  ];
  for (const provider of requiredProviders) {
    if (!pack.profiles.some((entry) => entry.provider === provider)) {
      errors.push(`Knowledge pack has no target profile for ${provider}`);
    }
  }

  const hostedKimiModels = new Set(
    pack.profiles
      .filter(
        (entry) =>
          entry.provider === "kimi" && entry.deployment.mode === "hosted",
      )
      .map((entry) => entry.model),
  );
  const selfHostedKimiModels = new Set(
    pack.profiles
      .filter(
        (entry) =>
          entry.provider === "kimi" &&
          entry.deployment.mode === "self_hosted",
      )
      .map((entry) => entry.model),
  );
  for (const model of ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"]) {
    if (!hostedKimiModels.has(model) || !selfHostedKimiModels.has(model)) {
      errors.push(`Kimi model ${model} needs separate hosted and self-hosted profiles`);
    }
  }

  const executableConformance = runKnowledgeRuleConformance({
    profiles: pack.profiles,
    rules: pack.rules,
  });
  for (const ruleId of executableConformance.missingHandlerRuleIds) {
    errors.push(`Rule ${ruleId} has no executable conformance handler`);
  }
  for (const ruleId of executableConformance.unappliedRuleIds) {
    errors.push(`Rule ${ruleId} does not apply to any target profile`);
  }
  for (const result of executableConformance.results) {
    for (const failure of result.failures) {
      errors.push(
        `Rule ${result.ruleId} failed for ${result.profileId}: ${failure}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      sources: pack.sources.length,
      profiles: pack.profiles.length,
      rules: pack.rules.length,
    },
  };
}

function issue(
  code: string,
  path: string,
  message: string,
  severity: ConformanceIssue["severity"] = "error",
): ConformanceIssue {
  return { code, path, message, severity };
}

export function validateTargetConfiguration(
  profileOrId: string | KnowledgeTargetProfile,
  input: unknown,
): ConformanceReport {
  const target =
    typeof profileOrId === "string"
      ? getTargetProfile(profileOrId)
      : KnowledgeTargetProfileSchema.parse(profileOrId);
  const parsed = TargetConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      profileId: target.id,
      issues: parsed.error.issues.map((entry) =>
        issue(
          "invalid_configuration",
          entry.path.join(".") || "configuration",
          entry.message,
        ),
      ),
    };
  }

  const request = parsed.data;
  const issues: ConformanceIssue[] = [];
  const allowedParameterNames = new Set(
    target.parameterRules.map((parameterRule) => parameterRule.name),
  );
  for (const parameterName of Object.keys(request.parameters)) {
    if (!allowedParameterNames.has(parameterName)) {
      issues.push(
        issue(
          "unsupported_parameter",
          `parameters.${parameterName}`,
          `${target.id} does not declare parameter ${parameterName}`,
        ),
      );
    }
  }
  for (const role of request.roles) {
    if (!target.roles.includes(role)) {
      issues.push(
        issue(
          "unsupported_role",
          "roles",
          `${target.id} does not support the ${role} role`,
        ),
      );
    }
  }
  if (
    request.reasoningMode !== null &&
    !target.reasoning.modes.includes(request.reasoningMode)
  ) {
    issues.push(
      issue(
        "unsupported_reasoning_mode",
        "reasoningMode",
        `${target.id} does not support reasoning mode ${request.reasoningMode}`,
      ),
    );
  }

  const capabilityChecks: readonly [
    keyof Pick<
      typeof request,
      | "tools"
      | "structuredOutput"
      | "image"
      | "video"
      | "promptCaching"
    >,
    keyof KnowledgeTargetProfile["supports"],
  ][] = [
    ["tools", "tools"],
    ["structuredOutput", "structuredOutput"],
    ["image", "image"],
    ["video", "video"],
    ["promptCaching", "promptCaching"],
  ];
  for (const [requestKey, supportKey] of capabilityChecks) {
    if (request[requestKey] && !target.supports[supportKey]) {
      issues.push(
        issue(
          "unsupported_capability",
          requestKey,
          `${target.id} does not support ${requestKey}`,
        ),
      );
    }
  }
  if (request.contextTokens > target.contextWindow) {
    issues.push(
      issue(
        "context_window_exceeded",
        "contextTokens",
        `${request.contextTokens} tokens exceed ${target.id}'s ${target.contextWindow}-token window`,
      ),
    );
  }
  if (
    request.toolChoiceMode !== null &&
    !target.toolCapabilities.toolChoiceModes.includes(request.toolChoiceMode)
  ) {
    issues.push(
      issue(
        "unsupported_tool_choice",
        "toolChoiceMode",
        `${target.id} does not support tool choice mode ${request.toolChoiceMode}`,
      ),
    );
  }
  if (request.dynamicTools && !target.toolCapabilities.dynamicLoading) {
    issues.push(
      issue(
        "unsupported_dynamic_tools",
        "dynamicTools",
        `${target.id} does not support dynamic tool loading`,
      ),
    );
  }
  if (request.strictToolSchemas && !target.toolCapabilities.strictSchemas) {
    issues.push(
      issue(
        "unsupported_strict_tool_schema",
        "strictToolSchemas",
        `${target.id} does not support strict tool schemas`,
      ),
    );
  }

  for (const parameterRule of target.parameterRules) {
    const value = request.parameters[parameterRule.name];
    if (value === undefined) {
      continue;
    }
    if (
      parameterRule.allowedValues.length > 0 &&
      !parameterRule.allowedValues.some((allowed) => allowed === value)
    ) {
      issues.push(
        issue(
          "invalid_parameter_value",
          `parameters.${parameterRule.name}`,
          `${target.id} does not allow ${parameterRule.name}=${String(value)}`,
        ),
      );
      continue;
    }
    if (
      parameterRule.fixedValue !== null &&
      value !== parameterRule.fixedValue
    ) {
      issues.push(
        issue(
          "fixed_parameter_mismatch",
          `parameters.${parameterRule.name}`,
          `${parameterRule.name} is fixed to ${String(parameterRule.fixedValue)}`,
        ),
      );
    } else if (
      parameterRule.fixedValue !== null &&
      parameterRule.omitWhenFixed
    ) {
      issues.push(
        issue(
          "omit_fixed_parameter",
          `parameters.${parameterRule.name}`,
          `${parameterRule.name} is fixed by ${target.id} and should be omitted`,
          "warning",
        ),
      );
    }
  }

  return {
    valid: !issues.some((entry) => entry.severity === "error"),
    profileId: target.id,
    issues,
  };
}

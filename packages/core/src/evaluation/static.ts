import {
  EvalResultSchema,
  PromptPackageSchema,
  type EvalCase,
  type PromptPackage,
} from "../contracts.js";
import type { z } from "zod";
import {
  advanceVerificationStatus,
  invalidateVerificationAt,
} from "./verification.js";

export type EvalResult = z.infer<typeof EvalResultSchema>;

export interface StaticFinding {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}

export interface StaticEvaluationReport {
  readonly mode: "static";
  readonly passed: boolean;
  readonly findings: readonly StaticFinding[];
  readonly results: readonly EvalResult[];
  readonly promptPackage: PromptPackage;
}

const REQUIRED_CATEGORIES: readonly EvalCase["category"][] = [
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

export const STRUCTURE_ONLY_WARNING =
  "[evaluation.structure_only] No task-output fixtures were supplied. This run validates package structure only and provides no behavioral evidence.";

function hasUnsafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "." || part.length === 0)
  );
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

interface CheckOutcome {
  readonly passed: boolean;
  readonly evidence: string;
}

type JsonSchema = Readonly<Record<string, unknown>>;

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "definitions",
  "deprecated",
  "description",
  "enum",
  "examples",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "oneOf",
  "properties",
  "readOnly",
  "required",
  "title",
  "type",
  "writeOnly",
]);

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * A deliberately small, non-executable check language. Checks are data, never
 * shell snippets or arbitrary JavaScript/regular expressions.
 */
export function runDeterministicCheck(check: string, output: string): CheckOutcome {
  if (check === "non_empty") {
    const passed = output.trim().length > 0;
    return { passed, evidence: passed ? "Output is non-empty." : "Output is empty." };
  }

  if (check === "valid_json") {
    try {
      JSON.parse(output);
      return { passed: true, evidence: "Output is valid JSON." };
    } catch {
      return { passed: false, evidence: "Output is not valid JSON." };
    }
  }

  const separator = check.indexOf(":");
  const operator = separator === -1 ? check : check.slice(0, separator);
  const operand = separator === -1 ? "" : check.slice(separator + 1);

  if (operator === "includes") {
    const passed = operand.length > 0 && output.includes(operand);
    return {
      passed,
      evidence: passed
        ? `Output includes the required literal ${JSON.stringify(operand)}.`
        : `Output does not include the required literal ${JSON.stringify(operand)}.`,
    };
  }

  if (operator === "excludes") {
    const passed = operand.length > 0 && !output.includes(operand);
    return {
      passed,
      evidence: passed
        ? `Output excludes the forbidden literal ${JSON.stringify(operand)}.`
        : `Output includes the forbidden literal ${JSON.stringify(operand)}.`,
    };
  }

  if (operator === "starts_with") {
    const passed = operand.length > 0 && output.startsWith(operand);
    return {
      passed,
      evidence: passed
        ? `Output starts with ${JSON.stringify(operand)}.`
        : `Output does not start with ${JSON.stringify(operand)}.`,
    };
  }

  if (operator === "ends_with") {
    const passed = operand.length > 0 && output.endsWith(operand);
    return {
      passed,
      evidence: passed
        ? `Output ends with ${JSON.stringify(operand)}.`
        : `Output does not end with ${JSON.stringify(operand)}.`,
    };
  }

  if (operator === "min_length" || operator === "max_length") {
    const limit = parsePositiveInteger(operand);
    if (limit === undefined) {
      return { passed: false, evidence: `Invalid numeric operand in check ${JSON.stringify(check)}.` };
    }
    const passed = operator === "min_length" ? output.length >= limit : output.length <= limit;
    return {
      passed,
      evidence: `${operator === "min_length" ? "Minimum" : "Maximum"} length ${limit}; actual length ${output.length}.`,
    };
  }

  return {
    passed: false,
    evidence: `Unsupported deterministic check ${JSON.stringify(check)}; refused instead of executing it.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describePath(path: string): string {
  return path.length === 0 ? "$" : `$${path}`;
}

function valueHasType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function schemaArray(value: unknown): readonly JsonSchema[] | undefined {
  if (!Array.isArray(value) || !value.every(isRecord)) return undefined;
  return value;
}

function validateSchemaValue(
  value: unknown,
  schema: JsonSchema,
  rootSchema: JsonSchema,
  path: string,
  depth: number,
): readonly string[] {
  if (depth > 32) {
    return [`${describePath(path)} exceeded the bounded schema-validation depth.`];
  }

  const issues: string[] = [];
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      issues.push(
        `${describePath(path)} uses unsupported schema keyword ${JSON.stringify(keyword)}; validation fails closed.`,
      );
    }
  }
  const type = schema["type"];
  if (typeof type === "string" && !valueHasType(value, type)) {
    issues.push(`${describePath(path)} must have type ${JSON.stringify(type)}.`);
    return issues;
  }
  if (
    Array.isArray(type) &&
    (!type.every((item) => typeof item === "string") ||
      !type.some((item) => valueHasType(value, item)))
  ) {
    issues.push(`${describePath(path)} does not match any declared type.`);
    return issues;
  }

  if (Array.isArray(schema["enum"]) && !schema["enum"].some((item) => jsonEquals(item, value))) {
    issues.push(`${describePath(path)} is not one of the allowed enum values.`);
  }
  if (Object.hasOwn(schema, "const") && !jsonEquals(schema["const"], value)) {
    issues.push(`${describePath(path)} does not equal the required constant.`);
  }

  const allOf = schemaArray(schema["allOf"]);
  if (allOf !== undefined) {
    for (const branch of allOf) {
      issues.push(...validateSchemaValue(value, branch, rootSchema, path, depth + 1));
    }
  }
  const anyOf = schemaArray(schema["anyOf"]);
  if (
    anyOf !== undefined &&
    !anyOf.some(
      (branch) => validateSchemaValue(value, branch, rootSchema, path, depth + 1).length === 0,
    )
  ) {
    issues.push(`${describePath(path)} does not satisfy any anyOf branch.`);
  }
  const oneOf = schemaArray(schema["oneOf"]);
  if (
    oneOf !== undefined &&
    oneOf.filter(
      (branch) => validateSchemaValue(value, branch, rootSchema, path, depth + 1).length === 0,
    ).length !== 1
  ) {
    issues.push(`${describePath(path)} must satisfy exactly one oneOf branch.`);
  }

  const reference = schema["$ref"];
  if (typeof reference === "string") {
    if (!reference.startsWith("#/")) {
      issues.push(`${describePath(path)} uses unsupported non-local schema reference ${reference}.`);
    } else {
      const segments = reference
        .slice(2)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
      let resolved: unknown = rootSchema;
      for (const segment of segments) {
        if (!isRecord(resolved) || !Object.hasOwn(resolved, segment)) {
          resolved = undefined;
          break;
        }
        resolved = resolved[segment];
      }
      if (!isRecord(resolved)) {
        issues.push(`${describePath(path)} has unresolved schema reference ${reference}.`);
      } else {
        issues.push(...validateSchemaValue(value, resolved, rootSchema, path, depth + 1));
      }
    }
  }

  if (isRecord(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const property of required) {
        if (typeof property !== "string" || !Object.hasOwn(value, property)) {
          issues.push(
            `${describePath(path)} is missing required property ${JSON.stringify(property)}.`,
          );
        }
      }
    }

    const properties = schema["properties"];
    const declared = isRecord(properties) ? properties : {};
    for (const [property, propertySchema] of Object.entries(declared)) {
      if (Object.hasOwn(value, property) && isRecord(propertySchema)) {
        const escapedProperty = property.replaceAll("~", "~0").replaceAll("/", "~1");
        issues.push(
          ...validateSchemaValue(
            value[property],
            propertySchema,
            rootSchema,
            `${path}/${escapedProperty}`,
            depth + 1,
          ),
        );
      }
    }

    const additionalProperties = schema["additionalProperties"];
    for (const property of Object.keys(value).filter((item) => !Object.hasOwn(declared, item))) {
      if (additionalProperties === false) {
        issues.push(
          `${describePath(path)} contains forbidden additional property ${JSON.stringify(property)}.`,
        );
      } else if (isRecord(additionalProperties)) {
        const escapedProperty = property.replaceAll("~", "~0").replaceAll("/", "~1");
        issues.push(
          ...validateSchemaValue(
            value[property],
            additionalProperties,
            rootSchema,
            `${path}/${escapedProperty}`,
            depth + 1,
          ),
        );
      }
    }
  }

  if (Array.isArray(value)) {
    const items = schema["items"];
    if (isRecord(items)) {
      value.forEach((item, index) => {
        issues.push(
          ...validateSchemaValue(item, items, rootSchema, `${path}/${index}`, depth + 1),
        );
      });
    }
    const minItems = schema["minItems"];
    if (typeof minItems === "number" && value.length < minItems) {
      issues.push(`${describePath(path)} must contain at least ${minItems} items.`);
    }
    const maxItems = schema["maxItems"];
    if (typeof maxItems === "number" && value.length > maxItems) {
      issues.push(`${describePath(path)} must contain at most ${maxItems} items.`);
    }
  }

  if (typeof value === "string") {
    const minLength = schema["minLength"];
    if (typeof minLength === "number" && value.length < minLength) {
      issues.push(`${describePath(path)} must contain at least ${minLength} characters.`);
    }
    const maxLength = schema["maxLength"];
    if (typeof maxLength === "number" && value.length > maxLength) {
      issues.push(`${describePath(path)} must contain at most ${maxLength} characters.`);
    }
  }

  if (typeof value === "number") {
    const minimum = schema["minimum"];
    if (typeof minimum === "number" && value < minimum) {
      issues.push(`${describePath(path)} must be at least ${minimum}.`);
    }
    const maximum = schema["maximum"];
    if (typeof maximum === "number" && value > maximum) {
      issues.push(`${describePath(path)} must be at most ${maximum}.`);
    }
  }

  return issues;
}

/**
 * Validate a generated JSON output against the safe, bounded JSON Schema
 * subset used by the core contracts. This executes no user-supplied code,
 * formats, or regular expressions.
 */
export function runOutputSchemaCheck(output: string, schema: JsonSchema): CheckOutcome {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return { passed: false, evidence: "Output is not valid JSON and cannot match the schema." };
  }

  const issues = validateSchemaValue(value, schema, schema, "", 0);
  return issues.length === 0
    ? {
        passed: true,
        evidence: "Output satisfies all supported constraints in the declared JSON Schema.",
      }
    : {
        passed: false,
        evidence: `Output violates the declared JSON Schema: ${issues.slice(0, 5).join(" ")}`,
      };
}

function evaluateOutput(
  evalCase: EvalCase,
  output: string,
  targetId: string,
  outputSchema: JsonSchema | undefined,
): EvalResult {
  const startedAt = performance.now();
  const checks =
    evalCase.deterministicChecks.length > 0 ? evalCase.deterministicChecks : ["non_empty"];
  const outcomes = checks.map((check) => runDeterministicCheck(check, output));
  if (evalCase.category === "output_schema" && outputSchema !== undefined) {
    outcomes.push(runOutputSchemaCheck(output, outputSchema));
  }
  const passedCount = outcomes.filter((outcome) => outcome.passed).length;
  const score = outcomes.length === 0 ? 1 : passedCount / outcomes.length;
  const durationMs = Math.max(0, performance.now() - startedAt);
  return EvalResultSchema.parse({
    caseId: evalCase.id,
    passed: passedCount === outcomes.length,
    score,
    evidence: outcomes.map((outcome) => outcome.evidence),
    mode: "static",
    targetId,
    durationMs,
    metrics: {
      outputValidity: score,
    },
  });
}

function validatePackageStructure(promptPackage: PromptPackage): StaticFinding[] {
  const findings: StaticFinding[] = [];
  for (const duplicate of duplicateValues(promptPackage.evals.map((item) => item.id))) {
    findings.push({
      code: "eval.duplicate_id",
      severity: "error",
      message: `Evaluation id ${JSON.stringify(duplicate)} is duplicated.`,
    });
  }

  for (const category of REQUIRED_CATEGORIES) {
    if (!promptPackage.evals.some((evalCase) => evalCase.category === category)) {
      findings.push({
        code: "eval.missing_category",
        severity: "error",
        message: `Required evaluation category ${JSON.stringify(category)} is missing.`,
      });
    }
  }

  const artifactKeys = promptPackage.artifacts.map(
    (artifact) => `${artifact.targetId}\u0000${artifact.filename}`,
  );
  for (const duplicate of duplicateValues(artifactKeys)) {
    const [targetId, filename] = duplicate.split("\u0000");
    findings.push({
      code: "artifact.duplicate",
      severity: "error",
      message: `Artifact ${JSON.stringify(filename)} is duplicated for target ${JSON.stringify(targetId)}.`,
    });
  }

  for (const artifact of promptPackage.artifacts) {
    if (hasUnsafeRelativePath(artifact.filename)) {
      findings.push({
        code: "artifact.unsafe_path",
        severity: "error",
        message: `Artifact filename ${JSON.stringify(artifact.filename)} is not a safe portable relative path.`,
      });
    }
  }

  const outputShapeCase = promptPackage.evals.find(
    (evalCase) => evalCase.category === "output_schema",
  );
  if (
    promptPackage.blueprint.intent.outputContract.format.trim().toLowerCase() === "json" &&
    outputShapeCase !== undefined &&
    !outputShapeCase.deterministicChecks.includes("valid_json")
  ) {
    findings.push({
      code: "eval.output_json_missing_check",
      severity: "error",
      message:
        "A JSON output contract requires the output_schema case to include the valid_json deterministic check.",
    });
  }

  if (promptPackage.artifacts.length === 0) {
    findings.push({
      code: "artifact.none",
      severity: "error",
      message: "The package has no compiled artifacts.",
    });
  }

  return findings;
}

export function evaluateStatic(
  promptPackage: PromptPackage,
  outputs: Readonly<Record<string, string>> = {},
): StaticEvaluationReport {
  const validatedPackage = PromptPackageSchema.parse(promptPackage);
  const findings = validatePackageStructure(validatedPackage);
  const targetIds = [...new Set(validatedPackage.artifacts.map((artifact) => artifact.targetId))];
  const results: EvalResult[] = [];
  const hasOutputFixtures = Object.keys(outputs).length > 0;

  if (!hasOutputFixtures) {
    findings.push({
      code: "evaluation.structure_only",
      severity: "warning",
      message: STRUCTURE_ONLY_WARNING.replace("[evaluation.structure_only] ", ""),
    });
  }

  for (const evalCase of validatedPackage.evals) {
    const output = outputs[evalCase.id];
    if (output === undefined) continue;
    for (const targetId of targetIds) {
      results.push(
        evaluateOutput(
          evalCase,
          output,
          targetId,
          validatedPackage.blueprint.intent.outputContract.schema,
        ),
      );
    }
  }

  const unknownOutputIds = Object.keys(outputs).filter(
    (id) => !validatedPackage.evals.some((evalCase) => evalCase.id === id),
  );
  for (const id of unknownOutputIds) {
    findings.push({
      code: "output.unknown_case",
      severity: "error",
      message: `Output was supplied for unknown evaluation case ${JSON.stringify(id)}.`,
    });
  }

  const outputsComplete =
    !hasOutputFixtures ||
    validatedPackage.evals.every((evalCase) => Object.hasOwn(outputs, evalCase.id));
  if (!outputsComplete) {
    findings.push({
      code: "output.incomplete",
      severity: "error",
      message: "When output fixtures are supplied, every evaluation case must have an output.",
    });
  }

  const passed =
    findings.every((finding) => finding.severity !== "error") &&
    results.every((result) => result.passed);
  const nextVerification = !hasOutputFixtures
    ? validatedPackage.verification
    : passed
      ? advanceVerificationStatus(validatedPackage.verification, "statically_validated")
      : invalidateVerificationAt(validatedPackage.verification, "statically_validated");
  const retainedResults =
    !hasOutputFixtures
      ? validatedPackage.results
      : validatedPackage.results.filter((result) => result.mode !== "static");
  const nextPackage = PromptPackageSchema.parse({
    ...validatedPackage,
    results: [...retainedResults, ...results],
    warnings: hasOutputFixtures
      ? validatedPackage.warnings.filter((warning) => warning !== STRUCTURE_ONLY_WARNING)
      : [...new Set([...validatedPackage.warnings, STRUCTURE_ONLY_WARNING])],
    verification: nextVerification,
  });

  return {
    mode: "static",
    passed,
    findings,
    results,
    promptPackage: nextPackage,
  };
}

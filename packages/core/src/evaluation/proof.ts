import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PromptPackageSchema,
  type PromptPackage,
} from "../contracts.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const HashSchema = z.string().regex(SHA256_HEX);

/** Stable serialization for identities written to receipts and CI artifacts. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Hash raw prompt or output content before passing it to receipt APIs. */
export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Evidence that a caller re-rendered a target artifact and got the expected
 * bytes. It intentionally carries a digest, never rendered prompt content.
 */
export const ProofArtifactEvidenceSchema = z.object({
  targetId: z.string().min(1),
  filename: z.string().min(1),
  /** Digest of the frozen artifact stored in the package. */
  storedContentHash: HashSchema,
  /** Digest emitted by the current local compiler. */
  renderedContentHash: HashSchema,
  passed: z.boolean(),
}).strict();
export type ProofArtifactEvidence = z.infer<typeof ProofArtifactEvidenceSchema>;

/**
 * A result tied to a frozen fixture. `outputHash` is the caller-provided
 * digest of any fixture output; raw fixture input/output must not enter the
 * resulting receipt.
 */
export const ProofReceiptObservationSchema = z.object({
  caseId: z.string().min(1),
  targetId: z.string().min(1),
  outputHash: HashSchema,
  passed: z.boolean(),
  checks: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
  }).strict()).min(1),
}).strict();
export type ProofReceiptObservation = z.infer<typeof ProofReceiptObservationSchema>;

const ProofStaticEvidenceSchema = z.object({
  passed: z.boolean(),
  findings: z.array(z.object({
    code: z.string().min(1),
    severity: z.enum(["error", "warning"]),
  }).strict()),
}).strict();

export const ProofReceiptSchema = z.object({
  /** Bump only for an intentionally incompatible receipt format. */
  version: z.literal("1.0.0"),
  status: z.enum(["passed", "failed"]),
  subject: z.object({
    packageId: z.string().min(1),
    /** Hash of the frozen semantic prompt subject. */
    subjectHash: HashSchema,
    /** Hash of the exact evaluation fixtures. */
    suiteHash: HashSchema,
    /** Hash of the redacted, per-case fixture-output digest map. */
    fixturesHash: HashSchema,
    /** SHA-256 digest for every current, re-rendered artifact. */
    artifactHashes: z.record(z.string().min(1), HashSchema),
    /** Hash binding the subject, suite, artifacts, and knowledge revision. */
    revisionHash: HashSchema,
    knowledgePackVersion: z.string().min(1),
  }).strict(),
  static: ProofStaticEvidenceSchema,
  artifacts: z.array(ProofArtifactEvidenceSchema).min(1),
  observations: z.array(ProofReceiptObservationSchema).min(1),
  /** Tamper-evident hash of this receipt excluding this field. */
  receiptHash: HashSchema,
}).strict();
export type ProofReceipt = z.infer<typeof ProofReceiptSchema>;

export const CreateProofReceiptRequestSchema = z.object({
  promptPackage: PromptPackageSchema,
  /** Summary of the deterministic fixture run, with no raw output content. */
  static: ProofStaticEvidenceSchema,
  /** Current local re-render evidence; no host or remote-execution assertion. */
  artifacts: z.array(ProofArtifactEvidenceSchema).min(1),
  /** Complete deterministic fixture/static result evidence. */
  observations: z.array(ProofReceiptObservationSchema).min(1),
}).strict();
export type CreateProofReceiptRequest = z.infer<typeof CreateProofReceiptRequestSchema>;

function artifactKey(targetId: string, filename: string): string {
  // Target IDs and portable filenames may both contain slashes. A structured
  // identity prevents distinct tuples from collapsing into one map/set key.
  return canonicalJson([targetId, filename]);
}

function proofSubject(
  packageValue: PromptPackage,
  artifacts: readonly ProofArtifactEvidence[],
  observations: readonly ProofReceiptObservation[],
): ProofReceipt["subject"] {
  const subjectHash = sha256Text(canonicalJson({
    id: packageValue.id,
    prompt: packageValue.prompt,
    knowledge: packageValue.knowledge,
  }));
  const suiteHash = sha256Text(canonicalJson(packageValue.evals));
  const artifactHashes = Object.fromEntries(
    artifacts
      .map((artifact) => [artifactKey(artifact.targetId, artifact.filename), artifact.storedContentHash] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const fixtureOutputHashes = new Map<string, string>();
  for (const observation of observations) {
    const existing = fixtureOutputHashes.get(observation.caseId);
    if (existing !== undefined && existing !== observation.outputHash) {
      throw new Error(`Proof observations disagree about fixture output for ${JSON.stringify(observation.caseId)}.`);
    }
    fixtureOutputHashes.set(observation.caseId, observation.outputHash);
  }
  const fixturesHash = sha256Text(canonicalJson(Object.fromEntries(
    [...fixtureOutputHashes.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )));
  return {
    packageId: packageValue.id,
    subjectHash,
    suiteHash,
    fixturesHash,
    artifactHashes,
    revisionHash: sha256Text(canonicalJson({
      id: packageValue.id,
      subjectHash,
      suiteHash,
      fixturesHash,
      artifactHashes,
      knowledge: packageValue.knowledge,
    })),
    knowledgePackVersion: packageValue.knowledge.packVersion,
  };
}

function assertCompleteStaticEvidence(promptPackage: PromptPackage): boolean {
  const expectedPairs = new Set(
    promptPackage.evals.flatMap((evalCase) =>
      promptPackage.artifacts.map((artifact) => `${evalCase.id}\u0000${artifact.targetId}`),
    ),
  );
  const staticResults = promptPackage.results.filter((result) => result.mode === "static");
  const observedPairs = new Set(staticResults.map((result) => `${result.caseId}\u0000${result.targetId}`));
  if (
    expectedPairs.size === 0 ||
    staticResults.length !== expectedPairs.size ||
    observedPairs.size !== expectedPairs.size ||
    [...expectedPairs].some((pair) => !observedPairs.has(pair))
  ) {
    throw new Error("Proof requires complete static evidence for every case/target pair.");
  }
  return staticResults.every((result) => result.passed);
}

function assertArtifactEvidence(
  promptPackage: PromptPackage,
  artifacts: readonly ProofArtifactEvidence[],
): void {
  const expected = new Map(
    promptPackage.artifacts.map((artifact) => [
      artifactKey(artifact.targetId, artifact.filename),
      sha256Text(artifact.content),
    ]),
  );
  const observed = new Set<string>();
  for (const artifact of artifacts) {
    const key = artifactKey(artifact.targetId, artifact.filename);
    if (observed.has(key)) throw new Error(`Proof artifact evidence duplicates ${JSON.stringify(key)}.`);
    if (expected.get(key) !== artifact.storedContentHash) {
      throw new Error(`Proof artifact evidence does not match the frozen artifact ${JSON.stringify(key)}.`);
    }
    if (artifact.passed !== (artifact.storedContentHash === artifact.renderedContentHash)) {
      throw new Error(`Proof artifact ${JSON.stringify(key)} has inconsistent local re-render status.`);
    }
    observed.add(key);
  }
  if (observed.size !== expected.size || [...expected.keys()].some((key) => !observed.has(key))) {
    throw new Error("Proof requires complete passing evidence for every compiled artifact.");
  }
}

function assertObservationCoverage(
  promptPackage: PromptPackage,
  observations: readonly ProofReceiptObservation[],
): void {
  const targetIds = new Set(promptPackage.artifacts.map((artifact) => artifact.targetId));
  const caseIds = new Set(promptPackage.evals.map((evalCase) => evalCase.id));
  const expectedPairs = new Set(
    promptPackage.evals.flatMap((evalCase) =>
      promptPackage.artifacts.map((artifact) => `${evalCase.id}\u0000${artifact.targetId}`),
    ),
  );
  const observedPairs = new Set<string>();
  for (const observation of observations) {
    if (!caseIds.has(observation.caseId) || !targetIds.has(observation.targetId)) {
      throw new Error(`Proof observation names an unknown case/target pair ${JSON.stringify(observation.caseId)} / ${JSON.stringify(observation.targetId)}.`);
    }
    const pair = `${observation.caseId}\u0000${observation.targetId}`;
    if (observedPairs.has(pair)) {
      throw new Error(`Proof observations contain duplicate case/target pair ${JSON.stringify(observation.caseId)} / ${JSON.stringify(observation.targetId)}.`);
    }
    if (observation.passed !== observation.checks.every((check) => check.passed)) {
      throw new Error(`Proof observation ${JSON.stringify(observation.caseId)} / ${JSON.stringify(observation.targetId)} has inconsistent check status.`);
    }
    observedPairs.add(pair);
  }
  const missingPairs = [...expectedPairs].filter((pair) => !observedPairs.has(pair));
  if (missingPairs.length > 0 || observedPairs.size !== expectedPairs.size) {
    throw new Error(`Proof evidence is incomplete; missing case/target pairs: ${missingPairs.map((pair) => pair.replace("\u0000", " / ")).join(", ") || "unknown extra pair"}.`);
  }
}

function receiptHash(receipt: Omit<ProofReceipt, "receiptHash">): string {
  return sha256Text(canonicalJson(receipt));
}

/**
 * Build a deterministic, local-only reproducibility receipt.
 *
 * This neither calls a model nor attests to an installed host. It binds frozen
 * package fixtures to caller-supplied current artifact digests, while raw
 * prompts, fixture inputs, and fixture outputs remain outside the receipt.
 * Invalid or partial evidence is rejected. Complete failures are represented
 * as a failed receipt so a CI job can retain the evidence while stopping.
 */
export function createProofReceipt(request: CreateProofReceiptRequest): ProofReceipt {
  const validated = CreateProofReceiptRequestSchema.parse(request);
  const staticEvidencePassed = assertCompleteStaticEvidence(validated.promptPackage);
  if (validated.static.passed !== staticEvidencePassed) {
    throw new Error("Proof static summary does not match the recorded static evidence.");
  }
  assertArtifactEvidence(validated.promptPackage, validated.artifacts);
  assertObservationCoverage(validated.promptPackage, validated.observations);

  const artifacts = [...validated.artifacts]
    .sort((left, right) => artifactKey(left.targetId, left.filename).localeCompare(artifactKey(right.targetId, right.filename)));
  const observations = [...validated.observations]
    .sort((left, right) => `${left.caseId}\u0000${left.targetId}`.localeCompare(`${right.caseId}\u0000${right.targetId}`));
  const unsigned = {
    version: "1.0.0" as const,
    status: validated.static.passed && observations.every((observation) => observation.passed) && artifacts.every((artifact) => artifact.passed)
      ? "passed" as const
      : "failed" as const,
    subject: proofSubject(validated.promptPackage, artifacts, observations),
    static: validated.static,
    artifacts,
    observations,
  };
  return ProofReceiptSchema.parse({ ...unsigned, receiptHash: receiptHash(unsigned) });
}

/** Verify a serialized receipt without access to prompt or fixture content. */
export function verifyProofReceipt(receipt: unknown): ProofReceipt {
  const parsed = ProofReceiptSchema.parse(receipt);
  const { receiptHash: storedHash, ...unsigned } = parsed;
  if (storedHash !== receiptHash(unsigned)) {
    throw new Error("Proof receipt hash does not match its contents.");
  }
  return parsed;
}

/** CI-friendly gate: a valid receipt must also represent a fully passing run. */
export function assertProofReceiptPasses(receipt: unknown): ProofReceipt {
  const verified = verifyProofReceipt(receipt);
  if (verified.status !== "passed") throw new Error("Proof receipt records a failed run.");
  return verified;
}

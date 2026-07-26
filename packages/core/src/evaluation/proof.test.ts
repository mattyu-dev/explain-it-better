import { describe, expect, it } from "vitest";

import { evaluateStatic } from "./static.js";
import {
  assertProofReceiptPasses,
  createProofReceipt,
  sha256Text,
  verifyProofReceipt,
} from "./proof.js";
import { makePromptPackage } from "../package/test-fixtures.js";

function staticallyValidatedPackage() {
  const promptPackage = makePromptPackage();
  return evaluateStatic(
    promptPackage,
    Object.fromEntries(promptPackage.evals.map((evalCase) => [evalCase.id, evalCase.category === "output_schema" ? "{}" : "answer"])),
  ).promptPackage;
}

function proofRequest() {
  const promptPackage = staticallyValidatedPackage();
  return {
    promptPackage,
    static: { passed: true, findings: [] },
    artifacts: promptPackage.artifacts.map((artifact) => ({
      targetId: artifact.targetId,
      filename: artifact.filename,
      storedContentHash: sha256Text(artifact.content),
      renderedContentHash: sha256Text(artifact.content),
      passed: true,
    })),
    observations: promptPackage.evals.map((evalCase) => ({
      caseId: evalCase.id,
      targetId: "openai-gpt",
      outputHash: sha256Text(`private output for ${evalCase.id}`),
      passed: true,
      checks: [{ id: "fixture-contract", passed: true }],
    })),
  };
}

describe("local proof receipts", () => {
  it("creates a deterministic, complete, redacted CI receipt", () => {
    const first = createProofReceipt(proofRequest());
    const second = createProofReceipt(proofRequest());

    expect(first).toEqual(second);
    expect(first.status).toBe("passed");
    expect(first.observations).toHaveLength(10);
    expect(JSON.stringify(first)).not.toContain("private output");
    expect(first.observations[0]?.outputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.subject.artifactHashes).toEqual({
      "openai-gpt/prompt.md": sha256Text("Answer the request and cite supplied evidence."),
    });
    expect(assertProofReceiptPasses(first)).toEqual(first);
  });

  it("fails closed when static or local evidence is incomplete", () => {
    const request = proofRequest();
    expect(() => createProofReceipt({ ...request, observations: request.observations.slice(1) })).toThrow(
      "incomplete",
    );
    expect(() => createProofReceipt({
      ...request,
      artifacts: [{ ...request.artifacts[0]!, storedContentHash: sha256Text("different") }],
    })).toThrow("does not match");
    expect(() => createProofReceipt({
      ...request,
      observations: request.observations.map((observation, index) => index === 0
        ? { ...observation, checks: [{ id: "fixture-contract", passed: false }], passed: true }
        : observation),
    })).toThrow("inconsistent check status");
  });

  it("represents complete failures but makes CI reject them", () => {
    const request = proofRequest();
    const receipt = createProofReceipt({
      ...request,
      static: { passed: false, findings: [{ code: "output.unknown_case", severity: "error" }] },
    });
    expect(receipt.status).toBe("failed");
    expect(() => assertProofReceiptPasses(receipt)).toThrow("failed run");
  });

  it("records deterministic validation failures without retaining fixture content", () => {
    const request = proofRequest();
    const receipt = createProofReceipt({
      ...request,
      observations: request.observations.map((observation, index) => index === 0
        ? { ...observation, passed: false, checks: [{ id: "fixture-contract", passed: false }] }
        : observation),
    });
    expect(receipt.status).toBe("failed");
    expect(() => assertProofReceiptPasses(receipt)).toThrow("failed run");
  });

  it("records compiler drift as a failed receipt without accepting altered frozen artifacts", () => {
    const request = proofRequest();
    const receipt = createProofReceipt({
      ...request,
      artifacts: request.artifacts.map((artifact, index) => index === 0
        ? { ...artifact, renderedContentHash: sha256Text("changed locally"), passed: false }
        : artifact),
    });
    expect(receipt.status).toBe("failed");
    expect(() => assertProofReceiptPasses(receipt)).toThrow("failed run");
  });

  it("rejects a receipt that was changed after issuance", () => {
    const receipt = createProofReceipt(proofRequest());
    expect(() => verifyProofReceipt({ ...receipt, subject: { ...receipt.subject, packageId: "different" } })).toThrow(
      "does not match",
    );
  });
});

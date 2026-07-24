import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makePromptPackage } from "./test-fixtures.js";
import { recordHumanApproval } from "./approval.js";

describe("recordHumanApproval", () => {
  it("records the exact pre-approval revision and advances only the approval label", () => {
    const promptPackage = makePromptPackage();
    promptPackage.blueprint.approvals.requiredFor.push("external_action");
    const expectedHash = createHash("sha256")
      .update(JSON.stringify(promptPackage), "utf8")
      .digest("hex");

    const approved = recordHumanApproval(promptPackage, {
      statement: "I reviewed this package before allowing external actions.",
      id: "d11b2af8-94e2-4b51-9e25-1b405fa06f2f",
      approvedAt: "2026-07-24T12:00:00.000Z",
    });

    expect(approved.verification).toBe("human_approved");
    expect(approved.approvalRecords).toEqual([
      expect.objectContaining({
        approver: "human",
        statement: "I reviewed this package before allowing external actions.",
        approvedPackageHash: expectedHash,
        approvalRequirements: ["external_action"],
      }),
    ]);
    expect(approved.approvalRecords[0]?.approvedPackageHash).not.toBe(
      createHash("sha256").update(JSON.stringify(approved), "utf8").digest("hex"),
    );
  });
});

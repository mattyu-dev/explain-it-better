import { createHash, randomUUID } from "node:crypto";
import {
  PromptPackageSchema,
  type HumanApprovalRecord,
  type PromptPackage,
} from "../contracts.js";
import { advanceVerificationStatus } from "../evaluation/verification.js";

export interface RecordHumanApprovalOptions {
  /** The explicit statement made by the person approving this revision. */
  readonly statement: string;
  /** Injectable for deterministic tests; callers normally omit both values. */
  readonly id?: string;
  readonly approvedAt?: string;
}

function hashPackageRevision(promptPackage: PromptPackage): string {
  return createHash("sha256").update(JSON.stringify(promptPackage), "utf8").digest("hex");
}

/**
 * Append an immutable approval record for the supplied package revision.
 * The recorded hash intentionally describes the pre-approval package, not
 * the resulting document which contains this new record.
 */
export function recordHumanApproval(
  promptPackage: PromptPackage,
  options: RecordHumanApprovalOptions,
): PromptPackage {
  const statement = options.statement.trim();
  const record: HumanApprovalRecord = {
    id: options.id ?? randomUUID(),
    approvedAt: options.approvedAt ?? new Date().toISOString(),
    approver: "human",
    statement,
    approvedPackageHash: hashPackageRevision(promptPackage),
    approvalRequirements: [...promptPackage.blueprint.approvals.requiredFor],
  };
  return PromptPackageSchema.parse({
    ...promptPackage,
    approvalRecords: [...promptPackage.approvalRecords, record],
    verification: advanceVerificationStatus(promptPackage.verification, "human_approved"),
  });
}

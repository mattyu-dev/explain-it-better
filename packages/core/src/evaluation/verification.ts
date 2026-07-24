import type { VerificationStatus } from "../contracts.js";

export const VERIFICATION_LADDER = [
  "compiled",
  "statically_validated",
  "proxy_evaluated",
  "target_evaluated",
  "human_approved",
] as const satisfies readonly VerificationStatus[];

function verificationIndex(status: VerificationStatus): number {
  return VERIFICATION_LADDER.indexOf(status);
}

export function isVerificationAtLeast(
  status: VerificationStatus,
  minimum: VerificationStatus,
): boolean {
  return verificationIndex(status) >= verificationIndex(minimum);
}

/**
 * Verification is monotonic. A lower evidence state can never replace a higher
 * one, which prevents a later static-only run from erasing native evidence.
 */
export function advanceVerificationStatus(
  current: VerificationStatus,
  candidate: VerificationStatus,
): VerificationStatus {
  return verificationIndex(candidate) > verificationIndex(current) ? candidate : current;
}

/**
 * A newly failed run replaces the result evidence for its own mode. In that
 * case the status must no longer imply that mode (or a higher one) is backed
 * by the currently stored results. This is deliberately the only downward
 * transition in the ladder.
 */
export function invalidateVerificationAt(
  current: VerificationStatus,
  failedStatus: VerificationStatus,
): VerificationStatus {
  const failureIndex = verificationIndex(failedStatus);
  return verificationIndex(current) >= failureIndex
    ? VERIFICATION_LADDER[Math.max(0, failureIndex - 1)]!
    : current;
}

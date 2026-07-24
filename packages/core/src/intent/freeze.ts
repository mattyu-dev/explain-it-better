import { IntentContractSchema, type IntentContract } from "../contracts.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
/**
 * Validates, clones, and recursively freezes an intent boundary so later prompt
 * optimization cannot silently rewrite the user's objective or constraints.
 */
export function freezeIntentContract(intent: IntentContract): IntentContract {
  return deepFreeze(IntentContractSchema.parse(intent));
}

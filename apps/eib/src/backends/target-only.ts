export const TARGET_ONLY_SAFETY_REASONS = {
  hermes:
    "Hermes is export-only: no verified isolated prompt-evaluation invocation is available.",
  kimi:
    "Kimi Code is export-only until an installed and authenticated CLI passes a reviewed isolated prompt-evaluation conformance test.",
} as const;

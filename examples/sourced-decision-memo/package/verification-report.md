# Verification report: eib-000cc7d8-dd95-415d-8ca4-fddf1ce91e7b

- Status: `statically_validated`
- Package version: `1.0.0`
- Knowledge pack: `2026.07.24-v2`
- Evaluation results: 10 (10 passed, 0 failed)

## Warnings

- Keep prompts lean and state each policy once.
- Exact model snapshots should be pinned by the caller when reproducibility is required.
- Target restriction: Do not request hidden chain-of-thought.
- Target restriction: Programmatic tool calling must not perform approval-gated actions.
- Target-specific restrictions require serializer validation: Do not request hidden chain-of-thought.; Programmatic tool calling must not perform approval-gated actions.

This report records evidence level; it does not claim universal prompt optimality.

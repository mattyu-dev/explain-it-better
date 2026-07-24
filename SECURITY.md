# Security Policy

## Reporting

Please report suspected vulnerabilities privately to the repository owner.
Include reproduction steps, affected versions, impact, and any suggested
mitigation. Do not include real credentials, personal data, or destructive
proofs of concept.

## Security boundaries

Explain It Better treats briefs, retrieved content, model output, generated
paths, tool arguments, and imported packages as untrusted data.

The following are release-blocking security invariants:

- No shell interpolation for local backend or installer commands.
- No implicit credential collection or storage.
- No target-client UI automation.
- No writes outside an explicit, validated installation target.
- No overwrite of unowned files without a reviewed patch and explicit apply.
- No claim that a prompt alone prevents prompt injection.
- No Hermes or Kimi compiler backend until a zero-tool conformance test passes.

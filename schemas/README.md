# Versioned Schemas

| Schema                                                                                                                 | Consumer                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`lab-manifest-v1.schema.json`](./lab-manifest-v1.schema.json)                                                         | Build-time Lab manifest loader                         |
| [`token-forge-input-v1.schema.json`](./token-forge-input-v1.schema.json)                                               | Token Forge input validation                           |
| [`token-forge-plan-v1.schema.json`](./token-forge-plan-v1.schema.json)                                                 | Template and AI-assisted Token Forge plans             |
| [`token-forge-export-v1.schema.json`](./token-forge-export-v1.schema.json)                                             | Local Markdown and GitHub Issue draft exports          |
| [`token-forge-event-v1.schema.json`](./token-forge-event-v1.schema.json)                                               | Minimal Token Forge conversion events                  |
| [`incident-detective-scenario-v1.schema.json`](./incident-detective-scenario-v1.schema.json)                           | Synthetic incident, evidence and timeline              |
| [`incident-detective-attempt-v1.schema.json`](./incident-detective-attempt-v1.schema.json)                             | Evidence order, budget and user hypothesis             |
| [`incident-detective-score-v1.schema.json`](./incident-detective-score-v1.schema.json)                                 | Deterministic score, dimensions and auditable findings |
| [`incident-detective-case-generation-input-v1.schema.json`](./incident-detective-case-generation-input-v1.schema.json) | Bounded AI case-proposal constraints                   |
| [`incident-detective-case-proposal-v1.schema.json`](./incident-detective-case-proposal-v1.schema.json)                 | Internal synthetic evidence outline requiring review   |
| [`incident-detective-case-review-v1.schema.json`](./incident-detective-case-review-v1.schema.json)                     | Explicit human decision and safety checklist           |
| [`incident-detective-share-card-v1.schema.json`](./incident-detective-share-card-v1.schema.json)                       | Score-only local SVG share data                        |
| [`smart-rma-fixture-index-v1.schema.json`](./smart-rma-fixture-index-v1.schema.json)                                   | Fully synthetic smartctl fixture corpus                |
| [`smart-rma-parse-result-v1.schema.json`](./smart-rma-parse-result-v1.schema.json)                                     | Browser-only structured SMART parse evidence           |
| [`smart-rma-boundary-projection-v1.schema.json`](./smart-rma-boundary-projection-v1.schema.json)                       | Allowlisted SMART data for AI and export boundaries    |
| [`ai-gateway-request-v1.schema.json`](./ai-gateway-request-v1.schema.json)                                             | Web-to-Gateway request envelope                        |
| [`ai-gateway-response-v1.schema.json`](./ai-gateway-response-v1.schema.json)                                           | Validated Gateway result or safe error                 |

Published Schema files are immutable contracts. Breaking changes require a new version, fixtures, consumer tests and migration notes.

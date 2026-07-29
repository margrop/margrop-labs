# Versioned Schemas

| Schema                                                                                                                 | Consumer                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`lab-manifest-v1.schema.json`](./lab-manifest-v1.schema.json)                                                         | Build-time Lab manifest loader                         |
| [`interview-resume-v1.schema.json`](./interview-resume-v1.schema.json)                                                 | Local sensitive resume contract                        |
| [`interview-jd-v1.schema.json`](./interview-jd-v1.schema.json)                                                       | Local sensitive job description contract               |
| [`interview-requirement-v1.schema.json`](./interview-requirement-v1.schema.json)                                     | Requirement registry and evidence targets              |
| [`interview-evidence-v1.schema.json`](./interview-evidence-v1.schema.json)                                           | Evidence references, support and unknown state         |
| [`interview-match-v1.schema.json`](./interview-match-v1.schema.json)                                                 | Deterministic match result, scores and review boundary |
| [`interview-plan-v1.schema.json`](./interview-plan-v1.schema.json)                                                   | 30/45/60 minute plan and human-review boundary         |
| [`token-forge-input-v1.schema.json`](./token-forge-input-v1.schema.json)                                               | Token Forge input validation                           |
| [`token-forge-plan-v1.schema.json`](./token-forge-plan-v1.schema.json)                                                 | Template and AI-assisted Token Forge plans             |
| [`token-forge-export-v1.schema.json`](./token-forge-export-v1.schema.json)                                             | Local Markdown and GitHub Issue draft exports          |
| [`token-forge-event-v1.schema.json`](./token-forge-event-v1.schema.json)                                               | Minimal Token Forge conversion events                  |
| [`token-forge-analytics-snapshot-v1.schema.json`](./token-forge-analytics-snapshot-v1.schema.json)                     | Aggregate-only Token Forge daily event counts          |
| [`token-forge-blog-cta-v1.schema.json`](./token-forge-blog-cta-v1.schema.json)                                         | Stable blog CTA copy and canonical links               |
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
| [`token-forge-ai-policy-v1.schema.json`](./token-forge-ai-policy-v1.schema.json)                                       | Token Forge AI budgets, rate limits and circuit bounds |

Published Schema files are immutable contracts. Breaking changes require a new version, fixtures, consumer tests and migration notes.

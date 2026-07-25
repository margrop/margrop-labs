# Versioned Schemas

| Schema | Consumer |
|---|---|
| [`lab-manifest-v1.schema.json`](./lab-manifest-v1.schema.json) | Build-time Lab manifest loader |
| [`token-forge-input-v1.schema.json`](./token-forge-input-v1.schema.json) | Token Forge input validation |
| [`token-forge-plan-v1.schema.json`](./token-forge-plan-v1.schema.json) | Template and AI-assisted Token Forge plans |
| [`token-forge-export-v1.schema.json`](./token-forge-export-v1.schema.json) | Local Markdown and GitHub Issue draft exports |
| [`token-forge-event-v1.schema.json`](./token-forge-event-v1.schema.json) | Minimal Token Forge conversion events |
| [`ai-gateway-request-v1.schema.json`](./ai-gateway-request-v1.schema.json) | Web-to-Gateway request envelope |
| [`ai-gateway-response-v1.schema.json`](./ai-gateway-response-v1.schema.json) | Validated Gateway result or safe error |

Published Schema files are immutable contracts. Breaking changes require a new version, fixtures, consumer tests and migration notes.

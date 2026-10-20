---
"effect": minor
"@effect/ai-cloudflare": minor
---

Add provider-neutral span and numeric extraction with strict and settled results, optional confidence, and Cloudflare Clairic support. Preserve typed provider options and metadata, normalize source offsets, and validate numeric constraints. Custom implementations and mocks of `CloudflareClient.Service` must now provide `createExtractions` alongside `client` and `createDecisions`; clients built with `make`, `layer`, or `layerConfig` already include it.

---
status: accepted
---

# OpenRouter EU as the interim AI provider

Until nunio switches to Amazon Bedrock (ADR-0011, still the target), all model calls go through OpenRouter's EU endpoint (`https://eu.openrouter.ai/api/v1`) on the Business plan, using `@openrouter/ai-sdk-provider` (AI SDK v7). The founder chose this because setting up Bedrock (AWS Organization, per-environment accounts, SCPs, OIDC roles) was too much setup for the current stage.

**Controls:**
- An organization guardrail restricts allowed data regions to the EU, so requests not sent via the EU endpoint are rejected before processing.
- Zero Data Retention is enforced for all models, and training and logging options are off.
- Separate staging and production API keys carry monthly credit limits.
- The model allowlist contains only models OpenRouter serves from in-region, zero-retention endpoints. Covered Models (Claude Fable, Mythos) stay excluded.
- ADR-0011's rules for model-calling code still apply: no forced tool calls, no batch for student content, no personal data in structured-output schemas. Use whichever structured-output mode works without forcing a tool.

**Consequences:**
- OpenRouter's EU routing covers the EU/EEA, the UK, and Switzerland, so ADR-0008 is amended to allow AI processing in the UK and Switzerland, both of which have EU adequacy decisions.
- OpenRouter's account, billing, and operational records may be processed in the US under its DPA with SCCs. OpenRouter and whichever provider serves each request are both processors in the pre-pilot DPA review.

**Unverified, checked in Phase 2 before relying on it:**
- which Claude models and embedding models are served in-region with zero retention;
- whether structured outputs and prompt caching pass through;
- that a request to a non-EU endpoint is actually rejected.

If embeddings are not available in-region, retrieval cannot ship on this provider, and that becomes a new decision.

**Amendment (2026-10-30, spike f):** for now, requests use OpenRouter's international routing (`https://openrouter.ai/api/v1`), and the EU-only guardrail is relaxed. EU routing is deferred and must be revisited before pilot release. Every request still goes only to zero-data-retention endpoints. The allowlist is the ZDR Claude and embedding models in [spike-results.md](../operations/spike-results.md#f-openrouter-2026-10-30). Structured output without forced tools and prompt caching are verified there.

**Amendment (2026-11-02, Phase 5 embeddings):** Source embeddings use `baai/bge-m3` (1024 dimensions) through the same international routing. The implementation plan asked for an in-region model; this is an explicit exception, not in-region processing. Requests pin only zero data retention and denied data collection, not a region, and the model's zero-retention providers are DeepInfra and Parasail. On the synthetic German/English eval ([phase-5-embedding-eval.json](../operations/phase-5-embedding-eval.json)) it tied with `amazon/titan-embed-text-v2` and was chosen for its lower listed price. Titan, served by Amazon Bedrock, fits the ADR-0011 target better. Switching models later means re-embedding every Source. The model ID and dimensions stored with each vector make that possible, but it is not free. Revisit both the routing and the model choice together with EU routing before pilot release, and against representative syllabi at the pilot-readiness gate.

## Considered Options

- **Amazon Bedrock EU (ADR-0011)**: the strongest controls and a single processor, but too much setup for now. It remains the target, and ADR-0011's AWS account is reserved.
- **Mistral direct**: EU-native and simple, but a different model family, with a manual training opt-out and unverified default retention.
- **OpenRouter EU** (chosen): one API key, an EU endpoint, and enforced zero retention, at the cost of an extra processor and Europe-wide (not EU-only) routing.

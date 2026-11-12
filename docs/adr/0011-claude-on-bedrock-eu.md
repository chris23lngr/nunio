# Claude on Amazon Bedrock (EU) as the single AI provider for the pilot

> **Amended (2026-11-19):** the model allowlist is now the Model Catalog ([ADR-0018](0018-model-catalog-in-the-database.md)).

> **Deferred (2026-10-30):** OpenRouter's EU endpoint is the interim provider ([ADR-0012](0012-openrouter-eu-as-interim-ai-provider.md)). This ADR remains the target. Its rules for model-calling code apply now; its AWS setup applies when nunio switches back. Render OIDC to AWS is now GA (Pro workspace), so the worker should use OIDC rather than access keys after the switch.

nunio's models are Claude Haiku, Sonnet, and Opus 5.5 on Amazon Bedrock, called through the EU cross-region inference profiles (`eu.anthropic.claude-*-5-5`) from `eu-central-1` with `@ai-sdk/amazon-bedrock/anthropic`. Embeddings also run on Bedrock, so retrieval adds no further processor. Anthropic's own API is ruled out because it can only process in `global` or `us`, which fails ADR-0008. On Bedrock, the EU profile destinations are a fixed set of EU regions, zero retention is a self-service setting that can be enforced by policy, AWS is the processor under its SCC-backed DPA, and Anthropic never receives the data. Evidence: [ai-providers.md](../research/ai-providers.md).

The pilot uses this single provider with no automatic fallback. If Bedrock is unavailable, AI work pauses visibly, following the brief's existing rule, while reminders and access to existing plans continue. Claude on Vertex AI `eu` is the documented alternative if Bedrock's gaps prove blocking. It keeps prompts identical but would add Google as a processor. Add a second provider only after the pilot, based on measured outages and evaluations.

## Decisions

- **Models.** Starting defaults are Haiku 5.5 for extraction and classification, Sonnet 5.5 for Agents, explanations, and Feedback, and Opus 5.5 for hard planning, each confirmed by evaluations before the pilot. The model allowlist holds only EU-pinned Bedrock IDs. Each model carries a data-handling label (provider, EU regions, zero retention). Covered Models (Fable, Mythos) are excluded because they require 30-day retention.
- **Embeddings.** Cohere Embed v4 (`eu.` profile) or Titan Text Embeddings V2 (in-region Frankfurt), chosen by a German/English syllabus retrieval test. Both model cards' end-of-life dates have passed, so checking Bedrock's deprecation notices is a gate before choosing.
- **Scanned PDFs.** Claude image input, sent from the worker (never the parser, ADR-0009), verified by a German scanned-syllabus test. A separate OCR provider would be a new decision with its own DPA.
- **Guardrails.** An AWS Organization with separate staging and production accounts used only for Bedrock. Retention mode `none` in `eu-central-1`, enforced by an SCP. `global.*` and `us.*` profiles and non-EU regions are denied. Model invocation logging is off. A CI check calls `GetInferenceProfile` and fails if any destination region outside the EU appears.
- **Rules for model-calling code**, from Bedrock's gaps:
  1. Never rely on a forced tool call (`tool_choice` is `auto` or `none` only on Sonnet/Opus 5.5).
  2. Structured output uses `outputFormat`, never `jsonTool`.
  3. No batch processing for student content.
  4. No personal data in structured-output schemas, which providers cache for up to 24 hours.
- **Credentials.** The API on Vercel uses Vercel OIDC federation to assume an IAM role, with no stored keys. The worker on Render uses least-privilege IAM access keys limited to `bedrock:InvokeModel*` on the allowed EU profiles, rotated with the master keys (ADR-0007), until Render OIDC federation is confirmed.

## Considered Options

- **Anthropic API direct**: no EU processing option.
- **Claude on Vertex AI `eu`**: only Sonnet 5.5 is confirmed in the EU. Kept as the alternative.
- **OpenAI EU residency / Azure EU Data Zone**: require sales approval and a 10% uplift (OpenAI), or may process in Switzerland or Norway (Azure), and would need a different model family's prompts and evaluations.
- **Mistral as primary or fallback**: EU-parented, but training opt-out is manual and default retention is unverified. As a fallback it would need its own prompts and evaluation suite, and it would add a processor to the DPA review.

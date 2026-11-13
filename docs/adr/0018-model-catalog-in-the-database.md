---

## status: accepted

# The Model Catalog lives in the database, priced from OpenRouter

Students choose the Model that answers their Chat. The Models, which of them Chat offers, and their prices used to be constants in `packages/ai`. Changing any of them needed a deploy, and the fixed prices fell behind OpenRouter's. They had already recorded the cheaper of each model's zero-retention endpoints, so `meter`'s estimate was no longer a guaranteed upper bound.

The Model Catalog is now a table, `catalog_model`, owned by `packages/delegation`. A Model is one exact call configuration: OpenRouter model, reasoning effort and output budget, under a neutral key such as `sonnet-5.5-reasoning-high`. Keys stay the same if nunio switches provider (ADR-0011). A Model never changes. A different configuration is a new Model, and a replaced one is retired, never deleted, so each Chat answer keeps pointing at the Model that wrote it (`chat_message.modelKey`).

- **Founder switches.** The founder enables, disables, orders and retires Models, and sets the Chat default, with an operator command (`docs/operations/environments.md`, "Model Catalog"). Each change is audited and none needs a deploy. A new Model takes one command and then the next sync. Choosing reasoning effort is the founder's call; students pick only a Model.
- **Prices.** A daily worker Schedule reads OpenRouter's public `/endpoints/zdr` list. It records, per Model and per long-context tier, the highest price across its zero-retention endpoints, along with the upstream providers. A Model missing from that list has no zero-retention endpoint, so it stops being used until one returns. The sync never writes the founder's switches.
- **Offered.** Chat offers a Model only if four things hold. It is enabled. It has a zero-retention endpoint. Its prices synced within 7 days. It is not a Covered Model. The denylist in `isCoveredModel` stays in code, so Fable and Mythos can never be added. Students never see why a Model is missing. A request for one is refused with `model_unavailable`, and the app switches back to the default.
- **Tasks.** Task defaults stay in code (`taskModels` in `packages/ai`), because evaluations choose them, and they refer to catalog keys. The API and worker read their task Models at start and refuse to start if one is missing. The operator command refuses to retire a Model a task still uses.

This amends ADR-0011's rule that "the model allowlist holds only EU-pinned Bedrock IDs" and ADR-0012's allowlist control: the code allowlist is replaced by the zero-retention sync plus the Covered Model denylist. Every request still pins zero retention and denied data collection.

**Not yet done.** Task Models are read only at start, so a long-running API instance or worker keeps estimating with the prices it started with. Unlike Chat, it does not yet stop using a Model whose prices go stale or that loses its zero-retention endpoint. Reading task Models per call is the follow-up.

**Amendment (2026-11-12, Chat tools, [ADR-0019](0019-the-chat-model-calls-tools.md)):** Chat offers a Model only if a fifth thing holds: one of its zero-retention endpoints supports tools and tool choice. The daily sync records each endpoint's supported parameters, and Chat requests set `provider.require_parameters`, so OpenRouter routes only to such endpoints. Prices stay the highest across all zero-retention endpoints, so the estimate remains an upper bound. Not yet verified: that `@openrouter/ai-sdk-provider` passes `require_parameters` through.

## Considered Options

- **Code allowlist, database switches**: keeps compliance under review, but every new Model and every price change still needs a deploy, and prices drift.
- **Prices typed into the database by hand**: no deploys, but a typo silently breaks the estimate bound and nothing checks zero retention.
- **A flag service or environment variables**: environment variables need a redeploy on Vercel, and a flag service adds a dependency and possibly a processor.

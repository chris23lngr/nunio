# What "EU hosting" means for the pilot

The brief requires EU hosting for core student data but does not promise EU-only processing. For the pilot, this means:

- Student data at rest and the compute that processes it stay in EU regions: Vercel `fra1`, Render Frankfurt, Neon `aws-eu-central-1`, Temporal Cloud `eu-central-1`, Hetzner `fsn1`. Never rely on a provider's default region; Vercel defaults to `iad1`.
- Processors with a US parent company are allowed when covered by SCC-backed DPAs. Neon's, Vercel's, and Temporal's DPAs permit some processing by US entities.
- A legal review of every processor's DPA (Vercel, Neon, Temporal, Render, Hetzner, and AWS for Bedrock, ADR-0011) is a gate before pilot release, not before building. For AWS Bedrock, the review checks:
  - whether the Anthropic third-party model terms apply;
  - whether retention mode `none` is contractually binding;
  - the subprocessor list;
  - that "no training on student content" is written into the contract.

We chose this over an EU-only processor rule because no viable managed option for durable workflows or serverless hosting meets it today, and a solo founder cannot self-host everything to the brief's quality bar. Where we could choose a provider without US processing at modest cost, we did (Hetzner, ADR-0007).

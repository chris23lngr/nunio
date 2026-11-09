---

## status: accepted

# Scaleway Transactional Email for authentication email

Phase 3 uses Scaleway TEM in `fr-par` for email verification and password recovery, bringing transactional delivery forward from Phase 10. The founder chose this for its documented France-based email processing rather than a sending region that leaves message storage elsewhere. Phase 10's notification routing, inbox and quiet hours remain separate.

The [service privacy policy](https://www.scaleway.com/en/docs/transactional-email/reference-content/data-privacy/) places content, metadata, logs, webhooks and backups in France. Message bodies are removed after delivery processing; backups remain for seven days. Recipient addresses, subjects and delivery metadata remain while the sending domain is active; targeted deletion can be requested through support. Manual account deletion must include that request where applicable. Recipient mailbox storage is outside Scaleway's control.

This is an email-workload boundary, not an all-company EU-only claim: [general account/support processing](https://www.scaleway.com/en/privacy-policy/) has a broader transfer boundary. The [DPA/contracts](https://www.scaleway.com/en/contracts/) and [subprocessor list](https://www.scaleway.com/en/subprocessorlist/) belong in the pre-pilot review under ADR-0008; choosing the provider does not record that review as completed.

The API uses the [documented REST endpoint](https://www.scaleway.com/en/docs/transactional-email/api-cli/send-emails-with-api/) in France. Messages contain a verification/reset link and minimal instructions, with no student materials or personal information in the subject. Auth tests stub outbound Scaleway HTTP while retaining real Postgres and Better Auth. DNS, sender validation and actual mailbox delivery require a separate staging smoke test before deployment is considered verified.

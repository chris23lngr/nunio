---

## status: accepted

# Content-free notification email on Scaleway Transactional Email

Phase 10 sends Intervention and Briefing emails through the same Scaleway TEM account as authentication email (ADR-0013), and those emails carry no personal content. The subject and body name only the kind and number of items, such as "nunio: 1 item needs your attention", and link to the Inbox; Course names, Obligations, rooms and Fact values never appear. We chose this so that the Inbox stays the only place the content lives, so that ADR-0013's boundary (Scaleway keeps recipients and subjects; recipient mailboxes are often outside the EU) covers notification email without widening it, and so that a forwarded or shared email reveals nothing. The cost is an email that is less useful on its own.

TEM permits transactional email only and may suspend the whole account, authentication email included, at its sole discretion ([outreach-delivery.md](../research/outreach-delivery.md) §5). Intervention emails are triggered by events for one student and fit its definition. Briefings are sent on the student's own schedule, which matches TEM's "preferences" wording, but Scaleway decides. We accept that risk for the pilot's low volume rather than adding a second provider. Each email has one recipient and no promotional content. Briefing emails link to notification settings, and they carry RFC 8058 one-click unsubscribe headers if a staging send confirms that TEM's DKIM signature covers them.

## Considered Options

- **Emails that describe the Intervention:** more useful without opening nunio. Rejected because content would reach Scaleway's retained subjects and mailboxes outside the EU.
- **A separate provider for notification email:** isolates authentication email from a suspension. Rejected for the pilot because it adds a second processor and DPA review for little volume. Revisit it if complaints or Briefing volume grow.

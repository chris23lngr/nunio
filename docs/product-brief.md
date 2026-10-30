# nunio — product brief

Status: confirmed by the founder after the product-concept interview (Q45).
Date: 2026-10-29.

## Purpose

nunio is a proactive study platform that reduces the coordination burden of studying and helps students carry work through to completion. It maintains an actionable understanding of courses, obligations, available time, and progress; initiates useful work; approaches students when appropriate; and acts within explicit permissions.

The central promise is: “I know what needs my attention, and the work of keeping my studies organized is largely handled.” Explanations, practice, drafting, and execution support that promise. Chat is one interface to the platform, not its organizing principle.

## Audience and delivery constraints

- Initial audience: university students aged 18+ managing multiple courses.
- Initial market: Germany, with German and English supported.
- Individual students choose and pay for the product. Institutional sales and school-age audiences are deferred.
- One founder, no launch deadline, and no set monthly infrastructure or AI budget.
- Pilot users already exist and are in direct contact with the founder. Their tool inventory is not yet known; no cohort size or university distribution has been agreed.
- Engineering quality is a baseline requirement. Scope should be narrowed rather than relying on fragile implementation.

## Complete study workflow

1. Import materials and optionally connect a calendar.
2. Identify courses, obligations, deadlines, and relevant source material, preserving provenance and uncertainty.
3. Have the student review extracted information and proposed automation permissions.
4. Maintain a realistic plan around commitments, priorities, protected time, and workload limits.
5. Help execute work through sourced explanations, practice with feedback, assignment drafting/review, and permitted completion.
6. Review or submit finished work according to explicit authority and supported destination coverage.
7. Track outcomes, follow up on unfinished work, and adapt the plan.

Target first-use value: a useful, reviewable result within ten minutes, using uploads alone if necessary. This is a pilot target, not a measured result. Ongoing responsibilities activate after scope and permission review.

## User experience and information model

- Home presents an actionable day: attention needed, prepared results, and ongoing background work. Chat stays accessible and connected to the current activity.
- Courses hold longer-lived academic context.
- Projects are optional outcome-oriented workspaces, such as an exam, thesis, or assignment. They bring together tasks, materials, chats, outputs, and responsibilities across one or more courses.
- Shared knowledge keeps facts consistent across the product. Students can inspect and correct it; isolated conversations can remain outside it.
- Chats and agents allow explicit selection of courses and materials. Retrieval is restricted to that selection by default. Operational context such as calendar availability is separately identified. Scope expansion requires authorization; relevant passages are retrieved rather than indiscriminately loading documents.
- Work completed and demonstrated understanding are tracked separately. Generated work is not evidence of student understanding. Practice and student feedback inform preparation without false precision in mastery claims.
- Explicit student edits take precedence over automated planning, with locks and undo where feasible. Later synchronization must not silently overwrite corrections to imported facts.
- When workload exceeds capacity, show the shortfall and propose tradeoffs. Do not silently overfill calendars, remove protected time, or drop obligations. Rebalance automatically within approved limits and priorities.

## Proactivity and configuration

Proactivity supports scheduled, event-driven, goal-driven, and follow-through behavior. Daily briefings and change alerts are presets, not the limits of the system.

Students primarily delegate ongoing responsibilities such as “keep this course organized” or “prepare me for this exam.” Each exposes scope, permissions, recent actions, next planned action, usage limits, and a pause control. Advanced users can configure agent details.

Provide presets, plain-language customization, and advanced settings. Natural-language changes become inspectable configuration; increases in authority require confirmation.

Task-specific preferences override course preferences, which override global defaults. Preferences cannot silently override hard constraints or permissions. Conflicts at the same authority level require clarification.

Initial notification channels: in-app, opt-in browser push, and email. Routing, urgency, quiet hours, and interruption frequency are configurable. Messaging-platform connectors are deferred pending demand.

After explicit authorization, nunio may create and reschedule its own study blocks. Existing external events remain constraints; changing them or their attendees requires separate authority.

## Completion, submission, and integrations

- Completion and submission of assessed work are in scope, subject to the assignment/course AI-use rules. Ask when those rules are unknown.
- Preparation and external commitments have separate permissions. Submission requires review of the artifact and destination by default; specific revocable automatic-submission permissions are possible.
- Automatic submission is enabled only for explicitly integrated and verified destinations. Unsupported destinations receive artifact preparation and manual handoff; completion requires confirmation.
- No general-purpose browser agent for arbitrary university websites in the initial scope.
- Choose initial connectors from pilot users' actual tools after investigating access and technical feasibility. No particular calendar, storage, or university connector is committed yet.
- Build an internal extension interface from the outset. Advanced agent customization includes instructions, context, triggers, supported tools, and permissions. Arbitrary executable third-party plugins and a public marketplace are deferred.
- Flashcards are generated/exported to tools students already use, with Anki a candidate destination. A native flashcard or spaced-repetition system is outside planned scope. Exact export/synchronization capabilities require later definition and verification.

## Architecture direction

Use a monorepo with dedicated web, backend API, and background worker apps from the beginning. Each has its own build and deployment lifecycle. Shared packages cover domain logic, database access, authentication, integration contracts, and UI where applicable.

Maintain clear ownership of identity, billing, course knowledge, planning, integrations, and agent execution. API requests and background jobs use the same business rules. Background work must survive restarts, support cancellation, and avoid repeating consequential actions.

Initial client: responsive web for desktop study work and mobile review/approval. Native mobile apps are deferred.

Stripe is the payment requirement; Better Auth is the authentication requirement. Other technologies and hosting providers remain undecided.

## Security, privacy, and reliability requirements

- EU hosting for core student data. External AI providers require verified processing locations, retention policies, contractual terms, and no training on student content. Exclusively EU processing across all providers is not yet promised.
- Enforce permissions in the application independently of model behavior. Treat uploaded and connected content as untrusted input. Grant least-privilege access to responsibilities.
- Isolate generated-code execution, control external access, and maintain inspectable histories of consequential actions.
- Support data export, deletion of sources and associated indexes/derived memory, and integration revocation. Disconnecting stops future access and affected automation; deletion of prior imports is a separate explicit action. Document backup deletion schedules.
- Continue independent work when a task is blocked. Surface deadline risks and needed decisions. Preserve artifacts, retry only when safe, and distinguish attempted actions from confirmed success.
- Before pilot release: automated checks; isolated development, staging, and production environments; background-job monitoring; tested backup recovery; documented rollback.
- Agent evaluations cover permission enforcement, malicious document instructions, extraction errors, duplicate actions, and false success claims.
- Formal certification is deferred until a business requirement exists. Concrete controls, test evidence, and operational documentation are required from the beginning.

## Commercial and model configuration

- Subscription with included AI usage; optional capped usage purchases can follow. Bounded trial rather than unrestricted free tier.
- Pilot is free with explicit usage limits. Set prices after measuring costs.
- Enforce budgets for background responsibilities. No automatic paid overages by default. Explain paused AI work while continuing ordinary reminders and access to existing plans.
- Automatically select suitable models by default. Advanced users may choose supported models per chat or responsibility, with capability, cost, and data-handling differences visible.
- User-supplied API keys and arbitrary model endpoints are deferred.

## Validation

Run an invite-only real-course pilot with the existing users, with no fixed end date. Measure coordination effort, obligations caught or missed, work completed, corrections and dismissed interventions, and willingness to pay. Chat volume is not the primary success measure.

The personal workspace is the initial scope. Sharing/exporting finished artifacts is supported as a direction; shared projects, study groups, collaborative editing, and multi-user agents are deferred.

## Open evidence and implementation decisions

These are not silently assumed or already verified:

- Pilot tool inventory and representative course materials/workflows.
- Connector access, provider permissions, submission confirmation mechanisms, and flashcard export capabilities.
- Initial supported assignment/output formats and exam-preparation details, informed by pilot examples.
- Provider and deployment choices, database/search/retrieval approach, durable job execution, and monorepo tooling.
- Numerical performance/reliability targets, retention periods, recovery objectives, AI evaluation thresholds, and pilot success thresholds.
- Cost measurements, plan allowances, subscription prices, and the operating budget.
- Detailed threat model, tenant isolation design, consent/account lifecycle, and applicable privacy/legal implementation review.
- Implementation sequence and the exact first pilot release slice. The accepted product scope is substantial and is not a commitment to deliver every capability in one development increment.

Next stage: use representative pilot workflows and technical research to produce a prioritized implementation plan against this confirmed product understanding. No implementation has begun.

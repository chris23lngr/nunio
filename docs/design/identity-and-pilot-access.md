# Identity and pilot access

Agreed with the founder on 2026-10-30. This refines Phase 3 and supersedes earlier four-week and expiring-pilot assumptions.

- Founder-issued invitations are email-bound, single-use, expire after seven days, and are shared manually. Acceptance reserves the invitation for a pending account; verification can resume without a new invitation. Pilot access activates only after email verification.
- Bring transactional email forward into Phase 3: Scaleway TEM for verification and password recovery. Record the DPA, France-based email processing boundary, broader account/support boundary, and recipient/subject metadata retention in an ADR before enabling delivery. Phase 10 notifications remain separate.
- Pilot access has no fixed duration. Explicit founder revocation blocks new uploads and AI work, preserving sign-in, existing results, and deletion requests.
- Allowances are finite, with manual grants and no automatic reset. Phase 3 establishes eligibility; Phase 4 defines usage units, amounts, and atomic metering before paid AI work becomes available.
- Students can list sessions, revoke individual sessions, and sign out everywhere. Password reset revokes all sessions. Sensitive actions require password confirmation within ten minutes.
- Deletion requests require recent authentication, immediately revoke sessions and block account use, new work, and ongoing student-content writes. Completion is manual; there is no self-service undo.
- Pilot revocation and exhausted Allowances stop ongoing work before its next paid call or student-content write. Already-sent requests may still incur costs. Narrow internal operations remain allowed for cost settlement, cancellation records, and deletion.
- Founder operations use commands with operator audit records, not an admin dashboard. Runtime student endpoints cannot issue invitations or grant access.
- Authentication uses database sessions, disabled cookie caching, and Postgres-backed rate limiting. Student-owned domain data uses forced RLS under a non-owner runtime role with transaction-local owner context. Auth tables have controlled access before a student is known.
- Phase 3 implements student authentication and the student/run Principal contract. Usable run authorization waits for Phase 9's persisted Runs and grants; a caller-supplied run ID never grants authority.
- MFA and email changes are deferred. Existing origin/CSRF protections remain mandatory.

## Implementation order

1. Shared auth rate limiting: two independent instances, real Postgres, sequential and concurrent enforcement.
2. Invitation-only registration at the auth HTTP seam, then founder invitation issuance at the operator-command seam.
3. Email verification/recovery and pending-account access restrictions; pilot entitlement activation.
4. Principals, domain authorization, restricted database roles and RLS; lifecycle and session controls.

Implement one behavior at a time with red → green tests. Invitation enforcement alone does not establish verified access or complete Phase 3.

## Pilot entitlement interface

The returned identity instance exposes `authenticate(request) → Actor | null`. It derives the student ID from a current, verified database session, without refreshing cookies. It never accepts caller-supplied ownership or pilot status.

`GET /api/me/entitlement` reads only that Actor's pilot status (`none`, `active`, or `revoked`). It has no target-student parameter and is never cacheable. Verification activates access only for an account reserved by an accepted invitation; existing verified accounts are not silently enrolled. Activation is idempotent and never clears a founder's revocation.

If verification persists the verified flag before entitlement activation fails, creating a new verified session retries activation using the same accepted invitation. This makes sign-in a recovery path without requiring another invitation. Existing revocations and their audit records remain unchanged.

The founder's `revoke-pilot` command targets a student ID through an operator database connection. It records revocation and operator attribution together. Repeated revocation preserves the original record; signing in and reading existing data remain permitted. No student-facing revocation or reactivation endpoint is introduced.

The API runs as a restricted `nunio_runtime` login. Billing reads and activates entitlements through `withOwner(prisma, principal, fn)` from `packages/delegation`, so forced RLS and the transaction-local owner context back the application-level selection. Usage amounts and enforcement remain Phase 4.

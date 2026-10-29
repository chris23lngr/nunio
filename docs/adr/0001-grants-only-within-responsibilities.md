# Grants exist only within Responsibilities

Standing authority (a Grant) is always attached to a single Responsibility; there are no global Grants such as "Agents may always create study blocks". Any Action outside a Responsibility, including one requested in a Chat, needs its own Approval for that exact Action. We chose this over global convenience settings so that every automatic Action traces back to one delegation the student can inspect, pause, and revoke, keeping authority least-privilege and the action history unambiguous.

## Considered Options

- **Global Grants usable by any Run**: fewer prompts, but authority would be detached from any inspectable delegation, and revoking one Responsibility would not reliably stop automatic Actions.
- **Grants only within Responsibilities** (chosen): more Approvals for one-off Chat Runs, in exchange for clear ownership of every automatic Action.

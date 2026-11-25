# Grants exist only within Agents

Standing authority (a Grant) is always attached to a single Agent; there are no global Grants such as "Agents may always create study blocks". Any Action outside an Agent, including one requested in a Chat, needs its own Approval for that exact Action. We chose this over global convenience settings so that every automatic Action traces back to one delegation the student can inspect, pause, and end, keeping authority least-privilege and the action history unambiguous.

## Considered Options

- **Global Grants usable by any Run**: fewer prompts, but authority would be detached from any inspectable delegation, and ending one Agent would not reliably stop automatic Actions.
- **Grants only within Agents** (chosen): more Approvals for one-off Chat Runs, in exchange for clear ownership of every automatic Action.

## Amendment (2026-11-18): approval modes

Agents run on the student's free-text Instructions, and the student sets a mode on each of an Agent's Capabilities that is an Action ([How the approval modes map onto Grants and Approvals](https://github.com/chris23lngr/nunio/issues/144)).

- **Modes.**
  - **Nachfragen:** the Agent holds no Grant for the kind, so every such Action is asked as an Approval.
  - **Immer erlaubt:** a Grant; the Agent acts without asking.
  - **Automatisch:** a Grant that still asks in cases nunio fixes. The student never configures them.
- **When Automatisch asks.** An Action needs Approval when it would break a Preference (study window, daily or work limit), or when it changes the next 24 hours: a Study Block that starts, moves or is removed within them, or a Task due within them. Under Immer erlaubt the same Action is taken, and the broken Preference is noted in the Run's Activity.
- **Others' blocks are always asked.** An Agent moves a Study Block it did not create only with Approval, so "Lernblöcke verschieben" is fixed to Nachfragen. A block counts as the Agent's own only if this Agent created it, including after an Approval, and the student has not moved it since. Blocks the student placed, other Agents' blocks and blocks from Chat proposals are never its own.
- **Refused in every mode.** A Locked block, a block that has started, a time in the past, Protected Time, an overlap with a Fixed Event or another Study Block, and work outside the Agent's scope are refused outright. Nothing is asked, and the model is told why.
- **Only Actions have a mode.** Capabilities that are not Actions, such as making flashcards or alerting the student, are on or off.
- **Defaults.** A newly added Capability starts as Automatisch for creating Study Blocks and for moving or removing the Agent's own blocks, and as Nachfragen for creating Tasks. Templates may set their own.
- **Changes apply at the next Action.** The gate reads the current mode for each Action, even in a Run under way. An Approval already asked stays asked: switching to Immer erlaubt approves nothing retroactively (ADR-0010).

We kept three modes rather than two because a student who wants their Agent to act freely should not be asked about short-notice changes they never care about, while the default still surfaces them. Moving the student's own blocks without asking was rejected: it would let an instruction hidden in a Source rearrange their week.

## Amendment (2026-11-18): an Agent's Courses are its scope

An Agent's scope is the Courses the student lists for it, at least one, never all by default ([Whether an Agent's Courses bound its Grants](https://github.com/chris23lngr/nunio/issues/145)). Every Action it takes, granted or asked, may touch only work of those Courses: their Obligations, Tasks in them or toward their Obligations, and Study Blocks for such work. Anything else is refused, even with Approval. A Grant therefore has no scope of its own and covers its kind across the Agent's Courses. Agents scoped to one Obligation are gone; focusing on an exam belongs in the Agent's instructions, because the authority it would withhold is only the rest of the same Course, whose student-placed blocks are asked anyway.

- **Archived Courses.** The Agent takes no Action for an Archived Course's work but still reads it as knowledge, and the Course stays on its list, returning to scope when unarchived. Only when all its Courses are Archived is the Agent Paused. The Course picker offers no Archived Course.
- **Changes apply at the next Action.** The gate checks the Agent's current Courses for each Action, so an Approval asked for a Course since removed is refused when approved.

## Amendment (2026-11-25): Grants on a Connection's tools

Integration tools are generic MCP, so the student would otherwise be asked about the same tool in every Chat and every Agent ([What "always allow" is and how it relates to Grants](https://github.com/chris23lngr/nunio/issues/260)). For Integration tools only, standing authority sits on the Connection instead of the Agent.

- **One setting per tool.** Each write tool of a Connection is Nachfragen or Immer erlaubt, and Immer erlaubt is a Grant held by the Connection. It covers every Chat the Connection is selected in and every Agent that has the tool turned on. An Agent's drawer shows the mode as read-only text, saying it applies to all Chats and Agents, with a link to the Connection's page. The mode changes only on the Approval card or the Connection's page ([Integrations UI](https://github.com/chris23lngr/nunio/issues/267)). There is no Automatisch for Integration tools.
- **On or off per Agent.** On an Agent, each read and write tool of a Connection is on or off, starting off. A tool that is off is not in the Agent's tool list, so an Agent gets only the tools it needs.
- **Bound to the tool.** A Grant covers one tool (the Connection and the tool's catalog name) with any arguments. nunio cannot render or check the arguments of a generic MCP tool, so it does not bind a Grant to them. A tool the catalog reclassifies, or that the server stops offering, loses its Grant.
- **Never grantable.** Sending email (send, reply, forward) and tools the catalog has not classified always ask.
- **Where it is set.** From the Approval card ("Immer erlauben"), which approves that exact Action (ADR-0010) and grants the tool from then on, and on the Connection's page, where every write tool is listed with its mode and can be revoked. Other open Approvals for the tool stay open; nothing is approved retroactively.
- **Lifecycle.** A Paused Agent takes no Integration Actions. Ending an Agent removes its on/off choices and leaves the Connection's Grants. Disconnect removes them, so a new Connection starts at Nachfragen. A Connection that Needs reconnection keeps its Grants while its tools are unavailable. Changes apply at the next Action, even in a Run under way.
- **Traceability.** Every Action taken under a Connection's Grant shows in the Run's Activity, or in the Chat, as taken without asking, with its arguments.
- **Chats accept bounded steering.** A Chat no longer asks before every Action: under a Connection's Grant, material the Chat reads (email, Sources) can steer it into a granted tool call without a click. We accept this as ADR-0026 does for Agents. It is bounded by the classification, the tools that are never grantable, Activity, and per-turn limits decided separately ([What bounds a Chat or Run that reads mail](https://github.com/chris23lngr/nunio/issues/265)).

Considered: per-Agent modes plus a separate global setting for Chats (two places deciding one tool), and a Connection ceiling each Agent could only narrow (two switches for one decision). One setting per tool was chosen because the student thinks of trusting a tool of their account, not of an Agent, and it keeps one place to look and revoke.

---

## status: accepted

# Routines prepare for and follow up on Course Events

Preparing for and following up on lectures is study work that belongs to a Course but to no Obligation. nunio had no place for it. A Study Block needs exactly one Obligation or Task. A Task has no Course of its own, so Grants, Course limits and Archiving never reach a Task without an Obligation. Rebalance skips such a Task, because it has no deadline. The Chat's Plan tool does not show it. Fixed Events carry only a title, so nunio cannot tell which ones are a Course's lectures.

We decided to close this gap for all Course work without an Obligation, with lecture preparation and follow-up as the leading case:

- **Tasks.** A Task may belong to a Course. With an Obligation, it belongs to the Obligation's Course and has no Course of its own.
- **Tasks tied to a Fixed Event.** A Task may refer to a Fixed Event as its Preparation or Follow-up, and its window follows from the Event Series.
  - A Preparation runs from the end of the previous Course Event of the series to the start of its own. For the first one in a series, it runs from 7 days before.
  - A Follow-up runs from the end of its Course Event to the start of the next one. For the last one in a series, it runs until 7 days after.
  - Rebalance gains an earliest start per Task, and the window's end is the Task's deadline.
- **Fixed Events keep their identity.** A Fixed Event keeps its external identity: the calendar UID and its recurrence ID, within its Source. A Fixed Event belongs to its Event Series. Adding a calendar again updates its events instead of adding new ones, so links to Tasks and Courses survive.
- **Assigning a series to a Course.** When a calendar is read, the model proposes a Course for each Event Series.
  - It receives the series title, weekday, time and rhythm, and the student's Courses as handles. It does not receive descriptions, locations or attendees.
  - The call is metered against the Allowance as part of reading the Source.
  - A proposal shows at once. A series becomes Course Events only when the student confirms it in Review, and only then does it produce Tasks.
  - A rejected proposal stays rejected when the calendar is read again.
- **Routines.** The student sets a Routine for each Event Series, either when confirming the series or later on the Course page. A Routine gives the minutes for Preparation, Follow-up or both.
  - Every day, and whenever a Routine or series changes, nunio adds Preparations and Follow-ups for Course Events in the next 14 days. Their Estimates come from the Routine and count as the student's own.
  - Adding these Tasks is the student's own planning, not an Action.
  - Their Study Blocks are planned like any other: by Rebalance within the Grants of `keep_course_organized`, or else as proposals for Approval.
- **Changes.**
  - **Changing a Routine:** only open Tasks with no past Study Block follow the change, and a Task whose Estimate the student set themselves keeps it.
  - **Moving a Course Event:** its Tasks' windows move with it.
  - **Cancelling a Course Event:** its open Tasks and their future Study Blocks go. Locked Study Blocks stay, and nunio tells the student.
  - **A Follow-up whose window passed undone:** it stays open as a backlog that nunio does not plan by itself.
- **Shortfall.** Preparations and Follow-ups count as ordinary work with their Course's Priority. A Shortfall also offers skipping a Routine for a period, so nothing is dropped silently.
- **Chat.**
  - The Plan tool shows Course Events, Preparations, Follow-ups and Tasks in a Course.
  - A request such as "I still need to follow up on lecture 3" becomes proposals for Approval, as in ADR-0019. Its Follow-up is reopened and gets new or longer Study Blocks. A new Task is added only if none exists.
  - Two new Action kinds, `task.create` and `task.reopen`, are asked from a Chat only. No Grant covers them.

## Considered Options

- **A time budget per Course** ("2 hours a week for OM"): needs no Tasks, but a Study Block would have to belong to a Course, and missed follow-ups would not show.
- **A Routine per Course and kind of event** (lecture, tutorial, lab): one setting per Course, but the model would have to classify the kind, and nunio would need a fixed list of kinds. A Routine per Event Series needs neither.
- **Routines inside `keep_course_organized`:** would reuse the daily Run, but lecture follow-up would need a delegation the student may not want. A Routine only adds Tasks. Placing their Study Blocks without asking still needs the Responsibility.
- **Tasks for the whole Semester at once:** the Plan would be complete at once, but every cancellation or Routine change would rework many Tasks.
- **Following up within a fixed span after each event:** simpler, but it fits courses that meet twice a week badly.
- **A calendar Connection now:** would read and write the student's real calendar. It still waits for the pilot tool inventory. Course assignment and Routines work on Fixed Events from any origin, so a Connection only feeds them better data.

## Consequences

- A future calendar Connection plugs into Event Series and external identity as they are. Writing Study Blocks into the student's calendar means recognizing them when the calendar is read back, so they never return as Fixed Events.
- The Course of a piece of work now comes from the Task when it has no Obligation. Grants, Course limits, Priority and Archiving therefore reach such Tasks.
- Linking Topics to Course Events, and offering Artifacts to prepare for one, are left for later.

# Deleting a Course keeps its Sources

Deleting a Course removes the Course and everything that exists only within it: its Obligations, Facts, Corrections, Tasks, Study Blocks, Estimates and Priority. Its Agents are Ended. Its Sources stay, and Chats and Projects lose only their link to it. A later reading of a remaining Source can therefore propose the Course again. That is intended: Reject is how the student keeps a Course away, and Archive is how they stop nunio working on one without losing anything.

## Considered Options

- **Delete the Course's Sources too**: nothing can bring it back, but a Source can belong to several Courses, and deleting Sources is already a separate, explicit choice.
- **Keep a hidden record that blocks re-proposal**: the same effect as Reject, under a second name the student could not see or undo.
- **Keep Sources and allow re-proposal** (chosen): each action means one thing. Delete forgets the Course, Reject keeps it away, Archive keeps it but stops nunio working on it.

## Amendment (2026-11-18): Agents lose the Course instead of Ending

Responsibilities became Agents, which may list several Courses ([Whether an Agent's Courses bound its Grants](https://github.com/chris23lngr/nunio/issues/145)). Deleting or Rejecting a Course now removes it from every Agent's list instead of Ending them; an Agent left with no Course is Paused, so the student can add a Course and resume it, or end it. Merging a Course into another moves it on every Agent's list to the surviving Course. Ending would have thrown away the student's instructions and Capabilities over a Course cleanup.

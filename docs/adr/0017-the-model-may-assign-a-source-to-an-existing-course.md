---

## status: accepted

# The model may assign a Source to an existing Course

Lecture decks often name a lecture topic instead of the official module. Exact code or title matching therefore proposes several Courses for one module and loses Topics when the proposed name cannot be grounded.

In automatic mode, extraction may pick an existing Course by ID from the student's accepted or proposed, unarchived, unmerged Courses in the current Semester. The Source title and candidate IDs, titles and codes are nonce-fenced untrusted user data, never system instructions or schema enum values. The server validates the ID against the supplied candidates and rechecks eligibility before attaching the Source. A picked Course needs no page quote; a new proposal still needs a page and verbatim quote. Unknown IDs receive no assignment authority and require grounding as a new proposal.

This narrowly amends extraction.md's principle that the model never decides two items are the same: the model may recognize which existing Course a Source belongs to. It cannot merge two existing Courses, change their names, accept a proposal, or bypass item grounding. Obligations and Facts reference picked Courses by ID within the Source's extracted course list. A student's explicit bound Course takes precedence and skips this automatic path.

## Considered Options

- Exact normalized code/title matching alone: predictable, but lecture titles rarely match module titles.
- A separate classification call: adds latency and cost; one extended extraction prompt can use the same context while extracting concrete Topics.
- Merge suggestions alone: leave unnecessary proposals and require repeated student decisions.

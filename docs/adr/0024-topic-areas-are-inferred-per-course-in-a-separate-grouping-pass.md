---

## status: accepted

# Topic Areas are inferred per Course in a separate grouping pass

A Course's Topics form one flat list, which grows long once several lecture decks are read. Students orient themselves by broader areas such as "Algorithmen" or "Prozesse", so the course page groups Topics into collapsible Topic Areas. nunio creates them itself when it reads Sources; the student does not have to.

We decided:

- **Inferred, not only quoted.** A Topic Area may be named by a document (a deck title, an agenda entry, a heading) or inferred by the model from the Topics alone. Unlike every extracted item, an Area needs no page and quote; its Provenance is its Topics' citations, and an inferred Area is marked as grouped by nunio.
- **Shape.** A Topic belongs to at most one Area. Areas have one level and no nesting. Topics in no Area show last under _Weitere Themen_; a Course without Areas shows its flat list. Areas and the Topics within each keep a stored order, first set from document order.
- **A separate pass per Course.** Topic extraction is unchanged. After a Source's extraction commits, and after Courses are merged, a small metered call (task `grouping`) reads each Topic of the Course: its name, the title of its first Source, its page and its quote. It also reads the Course's current Areas, renamed and rejected ones included. The pass never re-reads page text.
  - A Course with fewer than 8 Topics gets no Areas, and no call is made. An Area needs at least 2 Topics; the model aims for about 3–8 Areas, names them in the documents' language, and leaves a Topic ungrouped rather than force it into a weak Area.
  - If the call fails or the Allowance runs out, nothing changes and the Source's extraction status is unaffected. The next trigger tries again.
- **Sticky groups.** A later pass reuses existing Areas by name and only places Topics that have no Area yet. Topics already in an Area stay there, so the list does not reshuffle under the student.
- **Student control.** The student can rename an Area, reject it, and move a Topic to another Area or to none. Like a Correction, each keeps winning over later passes: a moved Topic stays put, a renamed Area keeps its name, and a rejected Area is never recreated and its Topics stay ungrouped. The student cannot create Areas by hand.
- **Not reviewed.** Areas are presentation, not claims about the Course, so they have no review state and do not appear in Review. They are managed on the course page.
- **Own table.** Areas live in `topic_area`, not as a `FactType`: a Fact needs extractions tied to one Source, page and quote, which an inferred Area has not.
- **Empty Areas.** An Area left without Topics (after Topic deletion or Rejection, Source deletion, or moves) is not shown and is deleted by the next pass. A rejected Area stays as a key so it is not recreated.
- **Merging Courses.** Areas with the same normalized name combine; the target's name and rejected state win. A Topic both Courses had keeps the target's Area, or the student's move. The pass then runs on the target.
- **No backfill.** Courses read before this change stay flat until their next extraction or merge. There is no manual trigger.

## Considered Options

- **Grouping inside topic extraction:** one call, but each 30k-token window would group on its own, naming the same Area differently, and the grouping instructions would share the prompt whose Topic precision and recall are measured in `docs/design/topic-quality.md`.
- **Areas only where a document names them:** keeps the quote rule, but decks with a flat agenda would yield no Areas, and Areas across several decks would rarely line up.
- **An Area as a Fact with review state:** reuses Review, but fakes Provenance for inferred Areas and puts presentation choices in front of the student as claims to confirm.
- **Regrouping everything the student has not touched on each pass:** may give better groups, but reshuffles the list after each new Source.

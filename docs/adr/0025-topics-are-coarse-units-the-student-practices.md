---

## status: accepted

# Topics are coarse units the student practices

Extraction asked for every distinct concept a page teaches, one concept per Topic. A single lecture deck yielded 15–30 Topics, and an introduction or module overview yielded Topics that are true but never matter again in the Course. A student cannot assess themselves on that many small Topics, and the Topic Areas (ADR-0024) only hide the problem. The Topic-quality work (`docs/design/topic-quality.md`) measured against fine labels with about 20 concepts per deck, so it pushed in the same direction.

We decided:

- **Size.** A Topic is a part of the Course that the student can practice and be assessed on as one unit, about the size of a lecture section: "Fourier-Transformation", not "Fourier-Koeffizient". The test is: would the student assess themselves on it and expect a practice item of its own? A term within such a part is not a Topic. The instructions give no target count.
- **Logistics yield no Topics.** Pages on schedule, dates, grading, attendance, literature or contact details yield no Topics; their Obligations, rules and exam logistics are still extracted. A document may yield no Topics at all.
- **Listed contents count.** Contents a module description or syllabus lists as the module's subject matter are Topics when they have that size. Remarks in passing, such as history or motivation, are not.
- **Names follow the documents.** A Topic takes the name of the heading or table-of-contents entry that covers it. Joining names with "und", "and" or "vs." stays forbidden unless the document names the section that way.
- **Existing Topics as context.** Extraction sees the names of the Topics its Course already has, and of all candidate Courses when the Source is not bound to a Course. It reuses an existing name for the same part instead of creating a variant. Rejected Topics are listed so they are not created again.
- **New measurement.** The fine labels and their decks are dropped. New labels come from the founder's own course documents, kept locally and referenced by SHA-256, labelled blind per Course. Each Course is read in upload order: introduction or schedule, module description, two to three lecture decks. Targets: Topic precision at least 85 %, recall at least 80 %, at most one false Topic per logistics document, and a median of no duplicate Topics per Course. This replaces the targets in `docs/design/topic-quality.md`. The judge is calibrated again (at least 90 % agreement on 50 decisions).
- **Model.** Extraction stays on Haiku 5.5. Only if a stop criterion hits before the targets are met does one comparison run with Sonnet 5.5 decide the model.

## Considered Options

- **Keep fine Topics and rely on Topic Areas:** no extraction change, but Self-assessment and practice would still hang on 25 small Topics per deck.
- **Two levels, coarse Topics with fine concepts below:** keeps the fine detail, but needs a new model and UI, and goes against making Topics coarser.
- **A target count in the instructions:** simple, but in the Topic-quality work a count capped what the model returned instead of shaping it.

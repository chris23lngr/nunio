---

## status: accepted

# The student sets Understanding Levels

Until now only graded Attempts moved an Understanding Level, and a Self-assessment that differed from them made the Level disputed. In practice that meant nunio told students they were not solid on a Topic they had just called solid themselves. The course page asks each student how well they know each Topic, and their answer has to be what nunio shows and acts on.

- **The Level is the student's latest Self-assessment.** It is one of not studied, weak, shaky or solid (Nicht gelernt, Schwachpunkt, Unsicher, Sicher), and not studied until the student says otherwise. The student can go back to not studied.
- **Attempts never move it.** They stay Evidence with their Feedback, and the latest graded Attempt is shown beside the Level, never against it. Disputed and "what the Attempts alone show" are gone.
- **Weak and shaky are what nunio treats as weak.** An Artifact is marked shaky, and a Chat may point to a weak spot, only for these two. A Topic not studied is a gap in coverage, not a weakness (ADR-0021).
- **A Chat sees the latest graded Attempt as context.** It may suggest practice because of it, but never contradicts the student's Level.
- **Existing Self-assessments keep their value.** Shaky stays shaky and solid stays solid. Every other Topic is not studied, even with graded Attempts.
- **A deleted Topic's Self-assessments stop counting.** Deleting a Topic rejects it (GLOSSARY.md, Reject). Its Attempts and Artifacts stay.

This replaces "fresh practice is the way to change a Level" in ADR-0002. That ADR's decision against decay still holds: a Level never fades, and it always shows when Evidence last supported it.

## Considered Options

- **Attempts set the Level until the student sets one:** the Level stays informative without any Self-assessment. But it would still tell a student who never set one that they are weak, and the source of a Level would change silently the first time they did.
- **Attempts propose a change the student confirms:** keeps practice meaningful for the Level. Deferred, because it can be added later without undoing this decision.
- **Two Self-assessment values beside an Attempt-driven Level (the old model):** precise about what nunio observed, but it contradicted the student, which is exactly what this decision removes.

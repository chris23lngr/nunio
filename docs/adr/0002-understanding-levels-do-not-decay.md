# Understanding Levels do not decay

An Understanding Level stays where its Evidence put it, however much time passes; instead, it always shows when Evidence last supported it. We rejected time-based decay (forgetting curves) because it would claim a precision about the student's memory that nunio does not have, and would turn nunio into the native spaced-repetition system the product brief puts out of scope. Staleness is surfaced through the last-Evidence date, and fresh practice is the way to change a Level.

## Considered Options

- **Decay toward "shaky" over time**: automatically flags stale Topics before exams, but invents precision and drags in a spaced-repetition model.
- **No decay, show last-Evidence date** (chosen): honest about what nunio actually knows; preparation logic must weigh staleness explicitly.

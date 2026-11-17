# Topic eval: coarse Topics (2026-11-17)

Measured with the ADR-0025 prompt and existing Topics as context, against the same labels and documents as `topic-eval-baseline.md`. Report: `topic-eval-coarse.json` (three runs, Haiku 5.5, judge Sonnet 5.5). Quotes from the course documents are stripped. BPM and LAwi `vl-02` and `vl-04` are still refused by the parser, so OM is the only Course read in full.

## OM

|                                             | Baseline           | Coarse Topics      | Target   |
| ------------------------------------------- | ------------------ | ------------------ | -------- |
| Topics per run (27 labels)                  | 115 / 110 / 90     | 35 / 33 / 34       | –        |
| Precision                                   | 0.20 / 0.18 / 0.14 | 0.73 / 0.83 / 0.78 | ≥ 0.85   |
| Recall                                      | 0.81 / 0.70 / 0.44 | 0.81 / 0.93 / 0.93 | ≥ 0.80   |
| Duplicates                                  | 13 / 10 / 9        | 5 / 5 / 5          | median 0 |
| False Topics from the organisation document | 8 / 9 / 8          | 0 / 0 / 1          | ≤ 1      |

The remaining duplicates are a section and its sub-aspect named apart, such as "Prognosefehler" and "Prognosequalität", or "Warteschlangentheorie" and "Warteschlangenanalyse".

## LAwi

The introduction deck `vl-01` now yields no Topics (baseline: 10–13). Recall stays low (0.14–0.21) because the parser refuses two of the four decks, which hold 11 of the 18 labels. One duplicate came from two apostrophes: "Gauß’sches" and "Gauß'sches Eliminationsverfahren".

## Other

`wwu-wi-excerpt` passes again; the baseline prompt ran out of output tokens on it. Obligation recall 0.99, deadline precision 0.97, Course recall 0.97. Cost USD 0.82.

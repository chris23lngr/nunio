# Topic quality

Status: accepted design, 2026-11-12. Phase A (measurement) is in progress on `feat/topic-quality`. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md); the extraction pipeline is described in [extraction.md](extraction.md).

## Goal

Measure Topic extraction reliably first, then improve it. The feature goes to `main` when Topic precision is at least 85 % and recall at least 80 % on the dev set. If a stop criterion hits first, it goes with a written justification. The stop criteria are: targets met; three consecutive iterations each gaining less than 2 percentage points; or budget exhausted. A final measurement on the held-out decks follows.

## Labels

- The founder labels every deck blind: no agent drafts and no model output beforehand. The earlier draft Topic labels in `set.json` are discarded.
- One Markdown file per deck in `apps/worker/evals/extraction/labels/<deck-id>.md`, versioned in git. The guide for labelling is [LEITFADEN.md](../../apps/worker/evals/extraction/labels/LEITFADEN.md).
- A file names its Course in a `Kurs: <title>` line, which must equal a Course title of the deck in `set.json`. Then comes one table:

  | Konzept       | Aliase                        | Seiten | optional | nur Abbildung |
  | ------------- | ----------------------------- | ------ | -------- | ------------- |
  | Quantisierung | Quantization; Quantisierungen | 3, 5–7 |          | ja            |

  Aliases are separated by `;`, and the Konzept counts as the first alias. Seiten are pages of the evaluated document: for an excerpt, page 1 is the first excerpt page. Each template states its offset. Booleans are `ja` or empty.
- `optional` concepts count neither as a miss nor as a false positive. `nur Abbildung` marks a concept that can only be understood from a figure; it measures the figure → Topic path.
- `parseTopicLabels` in `labels.ts` turns a file into `TopicLabel`s and throws on a malformed row, a duplicate concept or an empty alias, naming the line. `write-labels.ts` copies every file with rows into `set.json` and skips empty templates:

  ```sh
  apps/worker/node_modules/.bin/tsx apps/worker/evals/extraction/write-labels.ts
  ```

## Dataset

10–12 openly licensed slide decks from at least 4 Courses, about half of them illustration-heavy, including the 3 earlier slide decks. About 20 % are held out, split by Course: a held-out Course has all its decks held out. Held-out decks carry `heldOut: true` in `set.json`. The harness skips them unless `EVAL_HELD_OUT=1`, and they never run during iteration. PDFs are fetched by URL and checked by SHA-256, never committed.

## Matching

An LLM judge maps each extracted Topic to one labelled concept or to none. The judge is Claude Sonnet 5.5 via OpenRouter; the extractor stays Haiku 5.5. The founder checks 50 stratified judge decisions. Judge numbers count only at ≥ 90 % agreement with the founder.

## Runs and budget

Three runs per deck. At most USD 20 for the whole feature and USD 3 per live run.

## Baseline (2026-11-12)

The extraction code is unchanged from `main`. 8 dev decks, 3 runs each. MCT1 is excluded: the parser refuses it (PR #84). The judge is **not calibrated yet**; the checklist is `apps/worker/evals/extraction/calibration/baseline-bound.md`.

| Run                                                                                                 | Topic precision | Topic recall | Figure-only recall | Cost     |
| --------------------------------------------------------------------------------------------------- | --------------- | ------------ | ------------------ | -------- |
| Bound to the labelled Course (`EVAL_BOUND=1`), report `docs/operations/topic-quality-baseline.json` | 86.8 %          | 34.1 %       | 14.3 % (3 of 21)   | USD 0.66 |
| Course recognised by the model, as in the product's first upload (report not committed)             | 71.8 %          | 26.4 %       | 14.3 %             | USD 0.64 |

The bound run is the Topic baseline. The unbound run mostly measures Course recognition:
- Three excerpts don't name their Course, and with no existing Course extraction returned nothing.
- EC 607 was named "R for data science", so none of its Topics could match.

Findings:
- **Bound Sources without a Course name yield nothing.** `dhbw-digitaltechnik-flipflops` and `dhbw-bildverarbeitung-bildaufnahme` got 0 Topics in all 6 runs. The raw model answer was `{"courses":[],"obligations":[],"facts":[]}` for a 29-page, 48k-character window. A bound Source gets no candidate Courses in its context (`facts.ts`, "A Source bound to a Course puts everything there"). The instructions require every item to reference a picked or quoted Course, so with no Course name on the pages the model returns nothing.
- **The recall is capped by the instructions.** The founder labelled 13–30 required concepts per deck; the instructions ask for "roughly 5–20" and the model returns 7–14 per deck.
- Precision is high wherever Topics come back (68–97 % per deck).

## Phase B order

1. Offline diagnosis of the figure descriptions.
2. Scan prompt: no `[Abbildung]` line when a page has no figure.
3. Per-window Topic instructions, and deterministic dedup within one extraction. Topic identity and key stay unchanged.
4. A minimum quote length, and drop counts per reason. No per-item content is logged.
5. Typed figure Provenance, only if the diagnosis shows that the figure path costs recall.

## Out of scope

Course assignment when there is no confident match (ADR-0017 stays unchanged), model choice, retrieval, adversarial tests, refactoring Course resolution, page images for the extractor, re-ingesting old Sources, and the language of UI copy.

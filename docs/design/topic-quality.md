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

The extraction code is unchanged from `main`. 8 dev decks, 3 runs each. MCT1 is excluded: the parser refuses it (PR #84). Scores count the decks themselves; the scenario runs repeat the NLP decks and are left out.

| Run                                                                                                     | Judge                   | Topic precision | Topic recall | Figure-only recall |
| ------------------------------------------------------------------------------------------------------- | ----------------------- | --------------- | ------------ | ------------------ |
| **Bound to the labelled Course** (`EVAL_BOUND=1`), report `docs/operations/topic-quality-baseline.json` | **strict (calibrated)** | **73.2 %**      | **28.1 %**   | 14.3 % (3 of 21)   |
| Same run                                                                                                | first judge             | 83.7 %          | 31.1 %       | 14.3 %             |
| Course recognised by the model, as in the product's first upload (report not committed)                 | first judge             | 71.8 %          | 26.4 %       | 14.3 %             |

The bound run is the Topic baseline. It cost USD 0.66, plus USD 0.19 to re-judge it. The unbound run (USD 0.64) mostly measures Course recognition:
- Three excerpts don't name their Course, and with no existing Course extraction returned nothing.
- EC 607 was named "R for data science", so none of its Topics could match.

Findings:
- **Bound Sources without a Course name yield nothing.** `dhbw-digitaltechnik-flipflops` and `dhbw-bildverarbeitung-bildaufnahme` got 0 Topics in all 6 runs. The raw model answer was `{"courses":[],"obligations":[],"facts":[]}` for a 29-page, 48k-character window. A bound Source gets no candidate Courses in its context (`facts.ts`, "A Source bound to a Course puts everything there"). The instructions require every item to reference a picked or quoted Course, so with no Course name on the pages the model returns nothing.
- **The recall is capped by the instructions.** The founder labelled 13–30 required concepts per deck; the instructions ask for "roughly 5–20" and the model returns 7–14 per deck.
- Per-deck precision with the strict judge ranges from 53 % (`dhbw-digitaltechnik`) to 95 % (`rub-nlp-03`).

### Judge calibration

The founder delegated rating to an independent model rater (Claude Fable 5.2, medium). The rater saw no judge decisions. In round 1 the founder reviewed every disagreement.

1. **First judge**, sample `apps/worker/evals/extraction/calibration/baseline-bound.md` (seed 42):
   - 42 of 50 agreed with the rater.
   - 3 more were artefacts of the one-to-one rule: the rater saw no other Topics of the run.
   - The founder sided with the rater on all 5 real disagreements. That makes 45 of 50 (90 %), but 3 were false matches: broader, combined or workflow Topics. The precision was inflated by about 10 points.
2. **Strict judge** (`packages/ai/src/topic-judge.ts`), fresh sample (seed 7, 33 of 50 cases new). The rater also saw the run's other Topics. Agreement: **48 of 50 (96 %)**, and 32 of the 33 new cases.
   - "log-linear model" again collides with its own label's alias "Logistic regression", which another Topic in that run already matched.
   - "optimales Impedanzverhältnis" is narrower than the label "Impedanzverhältnis".

   The judge's numbers count from here (threshold ≥ 90 %).

## Phase B order

1. A bound Source shows the model its own Course, so a deck that never names its Course still yields items (finding above).
2. Offline diagnosis of the figure descriptions.
3. Scan prompt: no `[Abbildung]` line when a page has no figure.
4. Per-window Topic instructions, and deterministic dedup within one extraction. Topic identity and key stay unchanged.
5. A minimum quote length, and drop counts per reason. No per-item content is logged.
6. Typed figure Provenance, only if the diagnosis shows that the figure path costs recall.

After step 1 the founder moved step 4 forward: no Topic was grounded only in a figure description, and the instructions' cap
limits recall.

## Phase B results

Bound runs (`EVAL_BOUND=1`), 8 dev decks, 3 runs each, strict judge, scored over the decks themselves.

| Step                                                                                        | Topic precision | Topic recall | Figure-only recall | Cost     |
| ------------------------------------------------------------------------------------------- | --------------- | ------------ | ------------------ | -------- |
| Baseline                                                                                    | 73.2 %          | 28.1 %       | 14.3 % (3 of 21)   | USD 0.85 |
| 1. Bound Source sees its Course (#90), report `docs/operations/topic-quality-phase-b1.json` | 70.5 %          | 44.8 %       | 52.4 % (11 of 21)  | USD 0.79 |
- `dhbw-digitaltechnik-flipflops` and `dhbw-bildverarbeitung-bildaufnahme` now yield Topics: recall 0 → 47 % and 0 → 48 %.
- The other decks move within noise, except `dhbw-messtechnik-messbruecken` (20 → 39 %) and `uo-ec607-intro` (36 → 51 %).
- The model returns 13.8 Topics per run on average; the founder labelled 20.6 required concepts per deck.
- No Topic is grounded only in a figure description. Many unmatched Topics combine two concepts, such as
  "Brennweite und Zoom" or "Schaltwerk vs. Schaltnetz", which the strict judge does not count.
- No two Topics of one run matched the same label.

## Out of scope

Course assignment when there is no confident match (ADR-0017 stays unchanged), model choice, retrieval, adversarial tests, refactoring Course resolution, page images for the extractor, re-ingesting old Sources, and the language of UI copy.

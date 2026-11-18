# Topic eval baseline (2026-11-17)

Measured with the extraction prompt before ADR-0025, against the per-Course labels in `apps/worker/evals/extraction/labels/`. Report: `topic-eval-baseline.json` (three runs, Haiku 5.5, judge Sonnet 5.5 not yet recalibrated). Quotes from the course documents are stripped because the documents stay local.

## Topics

| Course | Ingested                                  | Topics per run (labels) | Precision          | Recall             | Duplicates  | False Topics from the organisation document |
| ------ | ----------------------------------------- | ----------------------- | ------------------ | ------------------ | ----------- | ------------------------------------------- |
| OM     | all 3 documents (run 3: one rate-limited) | 115 / 110 / 90 (27)     | 0.20 / 0.18 / 0.14 | 0.81 / 0.70 / 0.44 | 13 / 10 / 9 | 8 / 9 / 8                                   |
| LAwi   | 2 of 4 documents                          | 35 / 38 / 38 (14)       | 0.15 / 0.14 / 0.14 | 0.36 / 0.36 / 0.36 | 3 / 2 / 2   | 10 / 13 / 10                                |
| BPM    | none                                      | –                       | –                  | –                  | –           | –                                           |

Over all runs: precision 0.167, recall 0.398 (BPM counts as recall 0), median 2 duplicates per Course, at most 13 false Topics from one logistics document. Targets (ADR-0025): precision ≥ 0.85, recall ≥ 0.80, at most 1 false Topic per logistics document, median 0 duplicates. Cost: USD 0.96, of which the judge was USD 0.16.

## Not measured

- **BPM, all four documents: `unreadable`.** Their images are JPEGs wrapped in Flate (`[/FlateDecode, /DCTDecode]`), which qpdf does not decode, and the parser refuses any stream with a remaining unknown filter (`apps/parser/src/pdf.ts`). The text layer is fine. This is a product defect: students upload such compressed PDFs.
- **LAwi`vl-02` (110 pages) and `vl-04` (185 pages): `too_many_pages`.** The parser stops at 100 pages.
- **`wwu-wi-excerpt`** fails in all runs because the output is cut off at 32,000 tokens; it passed on 2026-11-11.

The baseline is the OM Course and half of LAwi. All three Courses are measured again once the parser accepts the BPM and LAwi documents.

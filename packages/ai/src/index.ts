/**
 * Model registry and bounded model calls (ADR-0011, ADR-0012).
 */

export { type Answerer, type AnswerStep, createAnswerer } from "./answer.js";
export {
  createEstimator,
  type EstimateRequest,
  type Estimator,
  type ProposedEstimate,
} from "./estimation.js";
export {
  createExtractor,
  type Extracted,
  type ExtractionContext,
  type Extractor,
  isDate,
  isTime,
  isTimeZone,
  type Page,
} from "./extraction.js";
export { createGrader, type GradeInput, type Grader } from "./grading.js";
export {
  createModels,
  type DataHandlingLabel,
  isDefiniteFailure,
  isTransientFailure,
  type ModelConfig,
  type Models,
  type ReasoningEffort,
  type RegisteredModel,
  type Task,
  taskModels,
} from "./models.js";
export {
  type CritiqueInput,
  createMaker,
  type DraftInput,
  type Flashcard,
  type Maker,
  type PracticeInput,
  type PracticeItem,
  type Written,
} from "./practice.js";
export {
  fetchZeroRetentionPrices,
  isCoveredModel,
  type PriceTier,
  priceZeroRetentionEndpoints,
  type SyncedModel,
} from "./prices.js";
export {
  createSeriesAssigner,
  type SeriesAssigner,
  type SeriesAssignmentInput,
  type SeriesCourse,
  type SeriesRequest,
} from "./series-assignment.js";
export {
  createEmbedder,
  createScanReader,
  type Embedder,
  figureMarker,
  isFigureLine,
  type ScanReader,
  SourceModelRejected,
} from "./source-models.js";
export { createTopicJudge } from "./topic-judge.js";

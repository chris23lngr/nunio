/**
 * Model registry and bounded model calls (ADR-0011, ADR-0012).
 */

export { type Answerer, type AnswerInput, createAnswerer } from "./answer.js";
export {
  createEstimator,
  type EstimateRequest,
  type Estimator,
  type ProposedEstimate,
} from "./estimation.js";
export {
  createExtractor,
  type Extracted,
  type Extractor,
  isDate,
  isTime,
  isTimeZone,
  type Page,
} from "./extraction.js";
export {
  createModels,
  type DataHandlingLabel,
  isDefiniteFailure,
  type ModelId,
  type Models,
  type RegisteredModel,
  type Task,
} from "./models.js";
export {
  createMaker,
  type Maker,
  type PracticeInput,
  type PracticeItem,
} from "./practice.js";
export {
  createEmbedder,
  createScanReader,
  type Embedder,
  type ScanReader,
  SourceModelRejected,
} from "./source-models.js";

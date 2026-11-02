/**
 * Model registry and bounded model calls (ADR-0011, ADR-0012).
 */
export { createModels, isDefiniteFailure, type DataHandlingLabel, type ModelId, type Models, type RegisteredModel, type Task } from "./models.js";
export { createEmbedder, createScanReader, SourceModelRejected, type Embedder, type ScanReader } from "./source-models.js";
export { createExtractor, type Extracted, type Extractor, type Page } from "./extraction.js";

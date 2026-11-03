/** Source lifecycle and Fact extraction and review. Scoped knowledge retrieval is implemented in Phase 7. */
export { createSources, IngestionError, maxSourceBytes, type Sources, type SourceStorage, type Ingestion } from "./sources.js";
export { createFacts, type Correction, type Facts, type ItemRef } from "./facts.js";
export { createSourceStorage, sourceStorageFromEnv } from "./storage.js";

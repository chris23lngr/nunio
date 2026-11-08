/** Source lifecycle, Fact extraction and review, Chats, and scoped knowledge retrieval. */
export { createSources, IngestionError, maxSourceBytes, type Sources, type SourceStorage, type Ingestion } from "./sources.js";
export { createFacts, type Correction, type Facts, type ItemRef } from "./facts.js";
export { createSourceStorage, sourceStorageFromEnv } from "./storage.js";
export { createChats, type Chats } from "./chats.js";
export { createKnowledgeReader, InvalidQueryError, type CitationRef, type FactType, type Item, type KnowledgeReader, type PromptData,
  type Provenance, type Query, type Retrieval, type ScopeRef } from "./reader.js";

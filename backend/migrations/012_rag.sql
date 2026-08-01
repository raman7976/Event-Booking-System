-- 012_rag.sql
-- Retrieval store for the bus vertical's agentic-RAG features (assistant + admin
-- text-to-SQL). One table, two kinds of chunk:
--   'bus_doc'      -> policy / timetable / FAQ text (semantic search for the assistant)
--   'sql_example'  -> question->SQL few-shot pairs (grounds the text-to-SQL agent);
--                     the SQL lives in metadata->>'sql'
-- Embeddings are 384-dim (all-MiniLM-L6-v2, generated locally by transformers.js).
-- A tsvector column gives a keyword fallback so retrieval still works with no LLM.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       VARCHAR(20) NOT NULL CHECK (kind IN ('bus_doc', 'sql_example')),
  source     VARCHAR(120),
  title      VARCHAR(200),
  content    TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding  vector(384),
  tsv        tsvector,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Approximate-nearest-neighbour index for cosine distance (<=>).
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

-- Keyword-fallback index.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_tsv ON rag_chunks USING gin (tsv);

-- Filter by kind cheaply.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_kind ON rag_chunks (kind);

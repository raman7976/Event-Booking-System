// RAG retrieval over rag_chunks. Embeds the query locally (no API key) and does a
// cosine-distance nearest-neighbour search; falls back to Postgres full-text
// (the tsv column) if embeddings are unavailable. Returns chunks with source/title
// so callers can cite them.
import { readPool } from '../config/db.js';
import { config } from '../config/env.js';
import { embedOne, toVectorLiteral } from './ai/embeddings.js';
import { logger } from '../utils/logger.js';

export async function retrieve(query, { kind = 'bus_doc', k = config.ai.ragTopK } = {}) {
  try {
    const vec = toVectorLiteral(await embedOne(query));
    const { rows } = await readPool.query(
      `SELECT id, source, title, content, metadata,
              1 - (embedding <=> $1::vector) AS score
         FROM rag_chunks
        WHERE kind = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [vec, kind, k],
    );
    if (rows.length) return rows;
  } catch (err) {
    logger.warn(`[rag] vector retrieve failed (${err.message}); using keyword fallback`);
  }

  // Keyword fallback — works with zero embeddings in the table.
  const { rows } = await readPool.query(
    `SELECT id, source, title, content, metadata,
            ts_rank(tsv, websearch_to_tsquery('english', $1)) AS score
       FROM rag_chunks
      WHERE kind = $2 AND tsv @@ websearch_to_tsquery('english', $1)
      ORDER BY score DESC
      LIMIT $3`,
    [query, kind, k],
  );
  return rows;
}

/** Compact context block for prompting: "[source] content" lines. */
export function toContextBlock(chunks) {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.source}${c.title ? ` — ${c.title}` : ''})\n${c.content}`)
    .join('\n\n');
}

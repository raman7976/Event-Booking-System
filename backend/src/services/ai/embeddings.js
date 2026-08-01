// Local text embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim). No API
// key, no rate limits, offline after the first model download (cached on disk).
// Used for RAG retrieval so the knowledge base keeps working even when no
// generation LLM (Groq) is configured.
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const EMBED_DIM = 384;

let extractorPromise = null;
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      logger.info(`[embed] loading local model ${config.ai.embeddingModel} …`);
      const extractor = await pipeline('feature-extraction', config.ai.embeddingModel);
      logger.info('[embed] model ready');
      return extractor;
    })();
  }
  return extractorPromise;
}

/** Embed one string -> number[384] (mean-pooled, L2-normalized). */
export async function embedOne(text) {
  const extractor = await getExtractor();
  const out = await extractor(String(text).slice(0, 8000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** Embed many strings sequentially -> number[][]. */
export async function embedMany(texts) {
  const res = [];
  for (const t of texts) res.push(await embedOne(t));
  return res;
}

/** Render a number[] as a pgvector literal: '[0.1,0.2,...]'. */
export const toVectorLiteral = (arr) => `[${arr.join(',')}]`;

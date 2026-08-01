// Ingests the bus knowledge base into rag_chunks: markdown policy/route/FAQ docs
// (kind='bus_doc') and question->SQL few-shot pairs (kind='sql_example'). Embeds
// each chunk locally (transformers.js, no API key) and fills a tsv for keyword
// fallback. Idempotent: wipes rag_chunks and re-ingests each run (small corpus).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePool, closePools } from '../config/db.js';
import { embedOne, toVectorLiteral } from '../services/ai/embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../../docs/bus');

// Split markdown on blank lines, then merge small blocks up to ~700 chars.
function chunkMarkdown(text) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && (cur + '\n\n' + b).length > 700) { chunks.push(cur); cur = b; }
    else cur = cur ? `${cur}\n\n${b}` : b;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function insertChunk(client, { kind, source, title, content, metadata }) {
  const embedding = toVectorLiteral(await embedOne(`${title || ''}\n${content}`));
  // Pass the tsvector source as its own param ($7) so no parameter is reused in
  // two type contexts (which Postgres rejects as "inconsistent types deduced").
  const tsvText = `${title || ''} ${content}`;
  await client.query(
    `INSERT INTO rag_chunks (kind, source, title, content, metadata, embedding, tsv)
     VALUES ($1, $2, $3, $4, $5, $6::vector, to_tsvector('english', $7))`,
    [kind, source, title || null, content, JSON.stringify(metadata || {}), embedding, tsvText],
  );
}

async function main() {
  const t0 = Date.now();
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith('.md'));
  const client = await writePool.connect();
  try {
    await client.query('DELETE FROM rag_chunks');

    let docChunks = 0;
    for (const file of files) {
      const text = await readFile(path.join(DOCS_DIR, file), 'utf8');
      const title = text.match(/^#\s+(.+)/m)?.[1] || file;
      for (const content of chunkMarkdown(text)) {
        await insertChunk(client, { kind: 'bus_doc', source: file, title, content });
        docChunks += 1;
      }
    }

    const examples = JSON.parse(await readFile(path.join(DOCS_DIR, 'sql_examples.json'), 'utf8'));
    for (const ex of examples) {
      await insertChunk(client, {
        kind: 'sql_example', source: 'sql_examples.json', title: ex.question,
        content: ex.question, metadata: { sql: ex.sql },
      });
    }

    console.log(`[ingest] done in ${Date.now() - t0} ms — ${docChunks} doc chunk(s) + ${examples.length} sql example(s).`);
  } finally {
    client.release();
    await closePools();
  }
}

main().catch(async (err) => {
  console.error('[ingest] failed:', err);
  await closePools().catch(() => {});
  process.exit(1);
});

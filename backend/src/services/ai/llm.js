// Groq chat client (OpenAI-compatible) for the bus agentic-RAG features. Supports
// tool calling, used by the assistant agent. Optional by design: when GROQ_API_KEY
// is unset, isEnabled() is false and callers fall back to deterministic behavior
// (same graceful-degradation pattern as the seat recommender / bus insights).
import { config } from '../../config/env.js';

let clientPromise = null;
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const Groq = (await import('groq-sdk')).default;
      return new Groq({ apiKey: config.groq.apiKey });
    })();
  }
  return clientPromise;
}

export const isEnabled = () => Boolean(config.groq.apiKey);

/**
 * Agentic loop: let the model call tools until it produces a final text answer
 * (or maxSteps is hit). `dispatch(name, args)` runs a tool and returns a
 * JSON-serializable result. Tool identities/args come from the model, but the
 * caller's dispatch is responsible for scoping every tool to the authenticated
 * user. Returns { answer, toolTrace }.
 */
export async function runToolLoop({
  system, userMessage, history = [], tools, dispatch, maxSteps = config.ai.assistantMaxSteps,
}) {
  const client = await getClient();
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: userMessage },
  ];
  const toolTrace = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const resp = await client.chat.completions.create({
      model: config.groq.model,
      messages,
      temperature: 0.2,
      tools,
      tool_choice: 'auto',
    });
    const msg = resp.choices[0].message;
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) return { answer: msg.content || '', toolTrace };

    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      let result;
      try {
        result = await dispatch(call.function.name, args);
      } catch (err) {
        result = { error: err.message };
      }
      toolTrace.push({ name: call.function.name, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  // Ran out of tool steps — force a final natural-language answer.
  const final = await client.chat.completions.create({
    model: config.groq.model,
    messages: [...messages, { role: 'user', content: 'Answer the user now using the tool results above. Do not call more tools.' }],
    temperature: 0.2,
  });
  return { answer: final.choices[0].message.content || '', toolTrace };
}

/** Single JSON-mode completion (used by the text-to-SQL agent). */
export async function chatJson({ system, user }) {
  const client = await getClient();
  const resp = await client.chat.completions.create({
    model: config.groq.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(resp.choices[0].message.content || '{}');
}

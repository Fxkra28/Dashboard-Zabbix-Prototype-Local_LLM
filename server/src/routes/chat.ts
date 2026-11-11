import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { buildFocus, cleanAnswer, getSnapshot, streamAnswer, systemText } from '../services/assistant.js';
import { claimWarmSlot, noteModelRead, parseTurns, publicMessage, warmAndPrefill } from '../services/chat.js';
import { AiUpstreamError, type OllamaStats } from '../clients/ai.js';
import { ZabbixApiError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { aiGuard } from '../clients/limits.js';
import { aiUse } from '../security/audit.js';
import { chatBody } from '../core/schemas.js';

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Called when the Assistant page opens, so the model is loaded, and has
   * read the snapshot, by the time the first question arrives. The prefill
   * runs only for a system text the model has not read yet, and never while
   * it is answering (ai.ts `prefillModel`). Fire-and-forget; answers at once.
   */
  app.get('/api/chat/warm', async (req, reply) => {
    if (!config.ai.enabled) {
      return reply.code(503).send({ error: 'ai_disabled', message: 'AI not configured' });
    }
    void warmAndPrefill(req.log, claimWarmSlot());
    return reply.code(202).send({ warming: true });
  });

  // Limited per user, and a hosted answer is charged to the daily token budget (limits.ts).
  app.post('/api/chat', { schema: { body: chatBody }, preHandler: aiGuard('chat') }, async (req, reply) => {
    if (!config.ai.enabled) {
      return reply.code(503).send({ error: 'ai_disabled', message: 'AI not configured' });
    }
    const turns = parseTurns(req.body);
    if (!turns) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Body must be { messages: [{ role: "user" | "assistant", content }] }, ending with a user turn.',
      });
    }

    // We write the raw stream ourselves; tell Fastify not to send a reply.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': req.id, // writeHead bypasses the reply headers requestId.ts sets
    });

    let closed = false;
    const send = (event: string, data: unknown) => {
      if (!closed) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // A reader who navigates away must not leave the model generating for
    // nobody. Abort the upstream request the moment the connection drops.
    //
    // Listen on the *response*, not `req.raw`: by the time this handler runs
    // Fastify has consumed the JSON body, so the request stream is already
    // finished and its 'close' fires at once, which would abort every answer
    // before the first token. (/api/stream gets away with `req.raw` only
    // because a bodiless GET is never read, so it never finishes.) The
    // response's 'close' also fires after our own `end()`, which is harmless.
    const ac = new AbortController();
    reply.raw.on('close', () => {
      closed = true;
      ac.abort();
    });

    const use = aiUse(req, 'chat');
    try {
      const snapStarted = Date.now();
      const { text, meta, sizes, frozen } = await getSnapshot();
      // A focus is garnish: without one the snapshot still answers the question.
      const focus = await buildFocus(turns[turns.length - 1].content).catch(() => null);
      const snapshotMs = Date.now() - snapStarted;
      send('context', meta);

      const started = Date.now();
      let firstTokenMs: number | null = null;
      let stats: OllamaStats = {};
      let answer = '';
      const options = { focus: focus?.text, onStats: (s: OllamaStats) => (stats = s), onUsage: use.onUsage };
      for await (const piece of streamAnswer(turns, text, ac.signal, options)) {
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - started;
          // The model has read the whole prompt, snapshot included.
          noteModelRead(systemText(text));
        }
        answer += piece;
        send('token', { t: piece });
      }
      const ms = Date.now() - started;
      use.done('answered');
      send('done', { ms, text: cleanAnswer(answer), firstTokenMs });
      req.log.info(
        {
          snapshotMs,
          snapshotSizes: sizes,
          frozen,
          focus: focus && [...focus.sites, ...focus.hosts],
          firstTokenMs,
          ms,
          turns: turns.length,
          ...stats,
        },
        'chat answered',
      );
    } catch (err) {
      use.done(ac.signal.aborted ? 'aborted' : 'failed');
      if (!ac.signal.aborted) {
        const detail =
          err instanceof AiUpstreamError || err instanceof ZabbixApiError || err instanceof ZabbixTimeoutError
            ? err.detail
            : undefined;
        req.log.error({ err, detail }, 'chat failed');
        send('error', { message: publicMessage(err) });
      }
    } finally {
      closed = true;
      reply.raw.end();
    }
  });
}

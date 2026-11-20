import type { FastifyInstance } from 'fastify';
import { config } from '../core/config.js';
import { answerLanguage, buildFocus, cleanAnswer, getSnapshot, sectionsFor, streamAnswer, systemText, warmFor, withheldLine } from '../services/assistant.js';
import { claimWarmSlot, noteModelRead, parseTurns, publicMessage, warmAndPrefill } from '../services/chat.js';
import { AiUpstreamError, type OllamaStats } from '../clients/ai.js';
import { ZabbixApiError, ZabbixTimeoutError } from '../clients/zabbix.js';
import { aiGuard, callerOf } from '../clients/limits.js';
import { takeHeavyPlace, takeSliPlace } from '../security/heavyLimit.js';
import { aiUse } from '../security/audit.js';
import { languageOf, modulesOf, roleAllows, roleOf } from '../security/auth.js';
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

  // Limited per user, and an answer from the hosted API or a model outside the network is charged to the daily token budget (limits.ts).
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
    // The places this question takes in the lines of the slow reports: each is freed by the read it was taken for, when that ends (BK-88).
    const caller = callerOf(req);
    const taken: (() => void)[] = [];
    const place = (grab: (who: string) => (() => void) | null) => () => {
      const release = grab(caller);
      if (release) taken.push(release);
      return release;
    };
    reply.raw.on('close', () => {
      closed = true;
      // A reader who left stops what was begun for them and frees their places at once. An answer that was given whole leaves its reads to finish into the cache, where the next question finds them
      // (a cold report queued behind the gate would otherwise lose its only reader and never run), and each frees its own place when it ends.
      if (reply.raw.writableFinished) return;
      ac.abort();
      for (const release of taken.splice(0)) release();
    });

    const use = aiUse(req, 'chat');
    try {
      const snapStarted = Date.now();
      // The model is shown what this user's own pages show them, and no more (ADR-0017): an administrator, and a portal with sign-in off, see the whole of it.
      const modules = roleOf(req) === 'admin' ? null : modulesOf(req);
      // The first question after a quiet spell waits for the slow views it needs, which the portal keeps for ten minutes.
      await warmFor(turns[turns.length - 1].content, modules);
      // A reader who left during that wait gets nothing more built for them: no snapshot and no detail reads (BK-91).
      if (ac.signal.aborted) return void use.done('aborted');
      const shown = modules ? sectionsFor(modules) : undefined;
      const { text, meta, sizes, frozen } = await getSnapshot(shown);
      if (ac.signal.aborted) return void use.done('aborted');
      const previous = turns.slice(0, -1).reverse().find((t) => t.role === 'user')?.content;
      // A focus is garnish: without one the snapshot still answers the question. A failure is logged, the error and not the question, so that a broken reader does not pass for a question that named nothing.
      const focus = await buildFocus(turns[turns.length - 1].content, modules, {
        operator: roleAllows(roleOf(req), 'operator'),
        previous,
        signal: ac.signal,
        places: { heavy: place(takeHeavyPlace), sla: place(takeSliPlace) },
      }).catch((err: unknown) => {
        if (!ac.signal.aborted) req.log.warn({ err }, 'chat focus failed');
        return null;
      });
      if (ac.signal.aborted) return void use.done('aborted');
      const snapshotMs = Date.now() - snapStarted;
      send('context', meta);

      const started = Date.now();
      let firstTokenMs: number | null = null;
      let stats: OllamaStats = {};
      let answer = '';
      let truncated = false;
      const options = {
        focus: focus?.text,
        onStats: (s: OllamaStats) => (stats = s),
        onUsage: use.onUsage,
        language: languageOf(req),
        // Two lines of the same kind: the parts of the estate the pages do not show, and what this question asked for beyond the snapshot and was not given.
        withheld: [shown ? withheldLine(shown) : null, focus?.notGiven].filter(Boolean).join('\n\n') || null,
        onFinish: (info: { truncated: boolean }) => (truncated = info.truncated),
      };
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
      // `remembered` is how many turns the model was given, the question included, so that the page can show where its memory of the conversation ends (FR-72); `language` is the one the answer was asked in (UX-73).
      send('done', { ms, text: cleanAnswer(answer), firstTokenMs, truncated, remembered: turns.length, language: answerLanguage(turns[turns.length - 1].content, languageOf(req)) });
      req.log.info(
        {
          snapshotMs,
          snapshotSizes: sizes,
          frozen,
          focus: focus && [...focus.sites, ...focus.hosts],
          detail: focus?.topics,
          truncated,
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

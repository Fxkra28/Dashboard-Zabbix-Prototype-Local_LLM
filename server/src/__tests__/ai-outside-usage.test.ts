import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * A model outside the machine's network can be billed like the hosted one, so its calls are counted against the daily budget (BK-69): the
 * model's own numbers when it sends them, else the size of what went in and came out. A model on this machine is never counted.
 * `fetch` is the stand-in for the gateway; everything else is the real path, down to the ledger the guard reads.
 */

const OUTSIDE = {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: 'https://gateway.example.com/v1',
  AI_API_KEY: 'key-for-tests',
  AI_MODEL: 'big-model',
  AI_OLLAMA_NATIVE: 'false',
  AI_ALLOW_REMOTE: 'true',
};
const OUTSIDE_OLLAMA = { ...OUTSIDE, AI_OLLAMA_NATIVE: 'true' };
const LOCAL = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'small', AI_OLLAMA_NATIVE: 'false' };
const LOCAL_OLLAMA = { ...LOCAL, AI_OLLAMA_NATIVE: 'true' };

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const name of ['AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL', 'AI_TIMEOUT_MS', 'AI_ALLOW_REMOTE', 'AI_LOCAL_ONLY', 'AI_DAILY_TOKENS_PER_USER', 'AI_DAILY_TOKENS_TOTAL']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const [ai, assistant, limits, audit] = await Promise.all([import('../clients/ai.js'), import('../services/assistant.js'), import('../clients/limits.js'), import('../security/audit.js')]);
  return { ...ai, ...assistant, ...limits, ...audit };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PROBLEM = { summary: 'A link went down.', tagsExplained: [{ tag: 'site', value: 'a', meaning: 'where' }], businessImpact: 'One site lost a link.', recommendation: 'Check the port.' };
const ANSWER_TEXT = JSON.stringify(PROBLEM);
const TURNS = [{ role: 'user' as const, content: 'What is wrong with the link at site A?' }];

const json = (body: unknown) => new Response(JSON.stringify(body));
const frames = (...list: unknown[]) => new Response(`${list.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`);
const ndjson = (...list: unknown[]) => new Response(list.map((l) => `${JSON.stringify(l)}\n`).join(''));
const delta = (content: string) => ({ choices: [{ delta: { content } }] });

/** Every request the portal made, with its body read back. */
function gateway(answer: (signal?: AbortSignal) => Response) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
      sent.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
      return answer(init?.signal);
    }),
  );
  return sent;
}
const chars = (body: Record<string, unknown>) => ((body.messages as { content: string }[]) ?? []).reduce((n, m) => n + m.content.length, 0);
const drain = async (stream: AsyncGenerator<string>) => {
  let text = '';
  for await (const piece of stream) text += piece;
  return text;
};

describe('Explain through a model outside the network', () => {
  it('charges the number the gateway reports', async () => {
    gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }], usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 321 } }));
    const { humanize } = await load(OUTSIDE);
    const used = vi.fn();
    await humanize('problem', { id: 1 }, used);
    expect(used.mock.calls).toEqual([[321]]);
  });

  it('adds the prompt and the answer when the gateway sends no total', async () => {
    gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }], usage: { prompt_tokens: 300, completion_tokens: 20 } }));
    const { humanize } = await load(OUTSIDE);
    const used = vi.fn();
    await humanize('problem', { id: 1 }, used);
    expect(used.mock.calls).toEqual([[320]]);
  });

  it('charges the size of what went in and came out when the gateway sends no count', async () => {
    const sent = gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }] }));
    const { humanize, estimatedTokens } = await load(OUTSIDE);
    const used = vi.fn();
    await humanize('problem', { id: 1 }, used);
    expect(used.mock.calls).toEqual([[estimatedTokens(chars(sent[0].body) + ANSWER_TEXT.length)]]);
    expect(used.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('adds Ollama\'s two counts when the model is Ollama, and its size otherwise', async () => {
    gateway(() => json({ message: { content: ANSWER_TEXT }, done: true, prompt_eval_count: 120, eval_count: 30 }));
    const first = await load(OUTSIDE_OLLAMA);
    const used = vi.fn();
    await first.humanize('problem', { id: 1 }, used);
    expect(used.mock.calls).toEqual([[150]]);

    const sent = gateway(() => json({ message: { content: ANSWER_TEXT }, done: true }));
    const second = await load(OUTSIDE_OLLAMA);
    const usedBySize = vi.fn();
    await second.humanize('problem', { id: 1 }, usedBySize);
    expect(usedBySize.mock.calls).toEqual([[second.estimatedTokens(chars(sent[0].body) + ANSWER_TEXT.length)]]);
  });

  it('charges an answer that came back unusable, since the gateway billed it, and a refused call nothing', async () => {
    gateway(() => json({ choices: [{ message: { content: '' } }], usage: { total_tokens: 50 } }));
    const { humanize } = await load(OUTSIDE);
    const used = vi.fn();
    await expect(humanize('problem', { id: 1 }, used)).rejects.toThrow();
    expect(used.mock.calls).toEqual([[50]]);

    gateway(() => new Response('upstream down', { status: 502 }));
    const refused = await load(OUTSIDE);
    const none = vi.fn();
    await expect(refused.humanize('problem', { id: 1 }, none)).rejects.toThrow();
    expect(none).not.toHaveBeenCalled();
  });

  it('charges what went out when the reader leaves after the request was sent', async () => {
    const left = new AbortController();
    const sent = gateway(() => {
      left.abort(new Error('reader left'));
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const { humanize, estimatedTokens } = await load(OUTSIDE);
    const used = vi.fn();
    await expect(humanize('problem', { id: 1 }, used, left.signal)).rejects.toThrow('reader left');
    expect(used.mock.calls).toEqual([[estimatedTokens(chars(sent[0].body))]]);
  });

  it('does the same for Ollama\'s own API: the input when the reader leaves, nothing for an error it reports', async () => {
    const left = new AbortController();
    const sent = gateway(() => {
      left.abort(new Error('reader left'));
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const first = await load(OUTSIDE_OLLAMA);
    const used = vi.fn();
    await expect(first.humanize('problem', { id: 1 }, used, left.signal)).rejects.toThrow('reader left');
    expect(used.mock.calls).toEqual([[first.estimatedTokens(chars(sent[0].body))]]);

    gateway(() => json({ error: 'model not found', prompt_eval_count: 9, eval_count: 9 }));
    const second = await load(OUTSIDE_OLLAMA);
    const none = vi.fn();
    await expect(second.humanize('problem', { id: 1 }, none)).rejects.toThrow();
    expect(none).not.toHaveBeenCalled();
  });

  it('counts nothing for a model on this machine, on either dialect', async () => {
    gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }], usage: { total_tokens: 321 } }));
    const v1 = await load(LOCAL);
    const used = vi.fn();
    await v1.humanize('problem', { id: 1 }, used);

    gateway(() => json({ message: { content: ANSWER_TEXT }, done: true, prompt_eval_count: 10, eval_count: 5 }));
    const native = await load(LOCAL_OLLAMA);
    await native.humanize('problem', { id: 1 }, used);
    expect(used).not.toHaveBeenCalled();
  });
});

describe('the Assistant through a model outside the network', () => {
  it('asks the gateway for its counts and charges them, once, when the answer ends', async () => {
    const sent = gateway(() => frames(delta('The link '), delta('is down.'), { choices: [], usage: { prompt_tokens: 70, completion_tokens: 20, total_tokens: 90 } }));
    const { streamAnswer } = await load(OUTSIDE);
    const used = vi.fn();
    expect(await drain(streamAnswer(TURNS, 'snapshot', undefined, { onUsage: used }))).toBe('The link is down.');
    expect(sent[0].body.stream_options).toEqual({ include_usage: true });
    expect(used.mock.calls).toEqual([[90]]);
  });

  it('charges the size of the question and the answer when no count comes', async () => {
    const sent = gateway(() => frames(delta('The link '), delta('is down.')));
    const { streamAnswer, estimatedTokens } = await load(OUTSIDE);
    const used = vi.fn();
    await drain(streamAnswer(TURNS, 'snapshot', undefined, { onUsage: used }));
    expect(used.mock.calls).toEqual([[estimatedTokens(chars(sent[0].body) + 'The link is down.'.length)]]);
  });

  it('charges Ollama\'s counts, or the size when it sends none', async () => {
    gateway(() => ndjson({ message: { content: 'Down.' }, done: false }, { done: true, prompt_eval_count: 80, eval_count: 12 }));
    const first = await load(OUTSIDE_OLLAMA);
    const used = vi.fn();
    await drain(first.streamAnswer(TURNS, 'snapshot', undefined, { onUsage: used }));
    expect(used.mock.calls).toEqual([[92]]);

    const sent = gateway(() => ndjson({ message: { content: 'Down.' }, done: false }, { done: true }));
    const second = await load(OUTSIDE_OLLAMA);
    const bySize = vi.fn();
    await drain(second.streamAnswer(TURNS, 'snapshot', undefined, { onUsage: bySize }));
    expect(bySize.mock.calls).toEqual([[second.estimatedTokens(chars(sent[0].body) + 'Down.'.length)]]);
  });

  it('charges what was written when the reader presses Stop mid-answer', async () => {
    const stop = new AbortController();
    gateway((signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('Half an answer'))}\n\n`));
          // a real fetch ends the body when its signal fires
          signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
        pull() {
          return new Promise(() => undefined);
        },
      });
      return new Response(body);
    });
    const { streamAnswer } = await load(OUTSIDE);
    const used = vi.fn();
    const stream = streamAnswer(TURNS, 'snapshot', stop.signal, { onUsage: used });
    const reading = (async () => {
      for await (const piece of stream) {
        if (piece) stop.abort(new Error('reader pressed Stop'));
      }
    })();
    await expect(reading).rejects.toThrow();
    expect(used).toHaveBeenCalledTimes(1);
    expect(used.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not charge a call the gateway refused, and asks a local model for no counts', async () => {
    gateway(() => new Response('no', { status: 401 }));
    const { streamAnswer } = await load(OUTSIDE);
    const used = vi.fn();
    await expect(drain(streamAnswer(TURNS, 'snapshot', undefined, { onUsage: used }))).rejects.toThrow();
    expect(used).not.toHaveBeenCalled();

    gateway(() => new Response('no', { status: 401 }));
    const refusedNative = await load(OUTSIDE_OLLAMA);
    const noneNative = vi.fn();
    await expect(drain(refusedNative.streamAnswer(TURNS, 'snapshot', undefined, { onUsage: noneNative }))).rejects.toThrow();
    expect(noneNative).not.toHaveBeenCalled();

    const sent = gateway(() => frames(delta('Fine.')));
    const local = await load(LOCAL);
    const none = vi.fn();
    await drain(local.streamAnswer(TURNS, 'snapshot', undefined, { onUsage: none }));
    expect(none).not.toHaveBeenCalled();
    expect(sent[0].body.stream_options).toBeUndefined();
  });
});

describe('the daily budget fills for a model outside the network (BK-69)', () => {
  const asker = { user: { sub: 'ana' }, ip: '10.0.0.5', log: { info: () => undefined } } as unknown as FastifyRequest;

  it('refuses the next call once what the gateway reported has used a person\'s share', async () => {
    gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }], usage: { total_tokens: 700 } }));
    const { humanize, aiUse, aiBudget } = await load({ ...OUTSIDE, AI_DAILY_TOKENS_PER_USER: '1000' });
    for (let i = 0; i < 2; i++) await aiUse(asker, 'explain').run((onUsage) => humanize('problem', { id: i }, onUsage));
    expect(aiBudget.usedBy('user:ana')).toBe(1400);
    expect(aiBudget.refusal('user:ana')).not.toBeNull();
    expect(aiBudget.refusal('user:olu')).toBeNull();
  });

  it('leaves the ledger empty for a model on this machine', async () => {
    gateway(() => json({ choices: [{ message: { content: ANSWER_TEXT } }], usage: { total_tokens: 700 } }));
    const { humanize, aiUse, aiBudget } = await load({ ...LOCAL, AI_DAILY_TOKENS_PER_USER: '1000' });
    await aiUse(asker, 'explain').run((onUsage) => humanize('problem', { id: 1 }, onUsage));
    expect(aiBudget.usedBy('user:ana')).toBe(0);
  });
});

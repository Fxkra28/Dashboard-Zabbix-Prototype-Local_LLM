import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import Anthropic from '@anthropic-ai/sdk';

/**
 * A failed AI call tells the viewer one short fixed sentence.
 * The model's address, what it sent back and the setting to change go to the BFF
 * log only, in the error's `detail`: the same split the Zabbix errors make.
 */

const LOCAL_ENV = {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: 'http://10.9.8.7:11434/v1',
  AI_MODEL: 'qwen3:8b',
  AI_OLLAMA_NATIVE: 'false',
};

/** `ai.ts` fresh, with `env` applied to the `config` it captures (see ai.test.ts). */
async function loadAi(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('../clients/ai.js');
}

/** An app with the real error handler whose `/x` runs `fn`, and the log lines it writes. */
async function appRunning(fn: () => Promise<unknown>) {
  const { registerErrorHandler } = await import('../http/errors.js');
  const lines: string[] = [];
  const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => lines.push(line) } } });
  registerErrorHandler(app);
  app.get('/x', fn);
  return { app, log: () => lines.join('\n') };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a model that cannot be reached', () => {
  it('shows the viewer a fixed sentence and keeps the address and the cause in the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED 10.9.8.7:11434')));
    const { humanize, AI_MESSAGE } = await loadAi(LOCAL_ENV);
    const { app, log } = await appRunning(() => humanize('problem', {}));

    const res = await app.inject({ url: '/x' });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'ai_error', message: AI_MESSAGE.unreachable });
    expect(res.body).not.toMatch(/10\.9\.8\.7|ECONNREFUSED|11434/);
    expect(log()).toContain('http://10.9.8.7:11434/v1');
    expect(log()).toContain('ECONNREFUSED');
    await app.close();
  });

  it('says "too long" for a timeout, and leaves the setting to raise for the log', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const { humanize, AI_MESSAGE } = await loadAi(LOCAL_ENV);
    const { app, log } = await appRunning(() => humanize('problem', {}));

    const res = await app.inject({ url: '/x' });

    expect(res.json().message).toBe(AI_MESSAGE.timeout);
    expect(res.body).not.toMatch(/AI_TIMEOUT_MS|AI_BASE_URL|10\.9\.8\.7|qwen3/);
    expect(log()).toContain('AI_TIMEOUT_MS');
    await app.close();
  });
});

describe('a model that answers with an error', () => {
  it('keeps what the server sent back out of the response, and in the log', async () => {
    const upstream = 'CUDA error: out of memory at /opt/ollama/llama/runner.cpp:481';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => upstream } as unknown as Response),
    );
    const { humanize, AI_MESSAGE } = await loadAi(LOCAL_ENV);
    const { app, log } = await appRunning(() => humanize('problem', {}));

    const res = await app.inject({ url: '/x' });

    expect(res.statusCode).toBe(502);
    expect(res.json().message).toBe(AI_MESSAGE.failed);
    expect(res.body).not.toMatch(/CUDA|runner\.cpp|HTTP 500|qwen3/);
    expect(log()).toContain('HTTP 500');
    expect(log()).toContain('CUDA error: out of memory');
    await app.close();
  });

  it('cuts the logged body at 200 characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'x'.repeat(5_000) } as unknown as Response),
    );
    const { humanize } = await loadAi(LOCAL_ENV);
    const failure = (await humanize('problem', {}).catch((e: unknown) => e)) as Upstream;
    expect(failure.detail?.length).toBeLessThan(260);
  });

  it('treats a failure line in Ollama\'s stream the same way', async () => {
    const { readOllamaStream, AI_MESSAGE } = await loadAi({ ...LOCAL_ENV, AI_OLLAMA_NATIVE: 'auto' });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`${JSON.stringify({ error: 'runner exited at /usr/lib/ollama' })}\n`));
        c.close();
      },
    });
    const failure = await (async () => {
      try {
        for await (const piece of readOllamaStream(body)) void piece;
      } catch (err) {
        return err as Upstream;
      }
    })();
    expect(failure?.message).toBe(AI_MESSAGE.failed);
    expect(failure?.detail).toContain('runner exited at /usr/lib/ollama');
  });
});

describe('a hosted model that fails', () => {
  it('gives each kind of SDK failure its fixed sentence and keeps the SDK wording for the log', async () => {
    const { anthropicFailure, AI_MESSAGE } = await loadAi({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-x' });

    const rejected = anthropicFailure(
      Anthropic.APIError.generate(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        undefined,
        new Headers(),
      ),
    );
    expect(rejected.message).toBe(AI_MESSAGE.refused);
    expect(rejected.detail).toContain('invalid x-api-key');
    expect(rejected.detail).toContain('recreate the BFF');

    const forbidden = anthropicFailure(
      Anthropic.APIError.generate(403, { type: 'error', error: { type: 'permission_error', message: 'not allowed' } }, undefined, new Headers()),
    );
    expect(forbidden.message).toBe(AI_MESSAGE.refused);

    const overloaded = anthropicFailure(
      Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, new Headers()),
    );
    expect(overloaded.message).toBe(AI_MESSAGE.failed);
    expect(overloaded.detail).not.toContain('recreate the BFF');

    expect(anthropicFailure(new Anthropic.APIConnectionTimeoutError()).message).toBe(AI_MESSAGE.timeout);
    expect(anthropicFailure(new Anthropic.APIConnectionError({ message: 'getaddrinfo ENOTFOUND api.anthropic.com' })).message).toBe(
      AI_MESSAGE.unreachable,
    );
    for (const e of [rejected, forbidden, overloaded, anthropicFailure(new Anthropic.APIConnectionError({ message: 'getaddrinfo ENOTFOUND api.anthropic.com' }))]) {
      expect(e.message).not.toMatch(/sk-ant|ENOTFOUND|anthropic\.com|claude-x/);
    }
  });

  it('does not tell a viewer to try again when the key was refused, because that cannot help', async () => {
    const { AI_MESSAGE } = await loadAi({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-x' });
    expect(AI_MESSAGE.refused).toMatch(/administrator/);
    expect(AI_MESSAGE.refused).not.toMatch(/\btry again\b/i);
    for (const other of [AI_MESSAGE.unreachable, AI_MESSAGE.failed, AI_MESSAGE.unusable]) expect(other).toMatch(/\bTry again\b/);
  });
});

describe('a model server that refuses the key it was sent', () => {
  const refuse = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status, text: async () => '{"error":"invalid api key"}' } as unknown as Response),
    );

  it.each([401, 403])('answers %i with the refused sentence and keeps the fix for the log', async (status) => {
    refuse(status);
    const { humanize, AI_MESSAGE } = await loadAi({ ...LOCAL_ENV, AI_API_KEY: 'k-test' });
    const { app, log } = await appRunning(() => humanize('problem', {}));

    const res = await app.inject({ url: '/x' });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'ai_error', message: AI_MESSAGE.refused });
    expect(res.body).not.toMatch(/invalid api key|k-test|qwen3|10\.9\.8\.7/);
    expect(log()).toContain(`HTTP ${status}`);
    expect(log()).toContain('recreate the BFF');
    await app.close();
  });

  it('leaves a 401 from a server it sent no key to as an ordinary failure, since no key of ours fixes it', async () => {
    refuse(401);
    const { humanize, AI_MESSAGE } = await loadAi({ ...LOCAL_ENV, AI_API_KEY: '' });
    const { app } = await appRunning(() => humanize('problem', {}));

    const res = await app.inject({ url: '/x' });

    expect(res.json().message).toBe(AI_MESSAGE.failed);
    await app.close();
  });
});

/**
 * Every other place that raises an AiUpstreamError. Each must hand the viewer
 * its own fixed sentence, exactly, and keep what is internal in `detail`: a
 * site that slipped back to "model name + address" would still be an
 * AiUpstreamError, so the message is compared whole, not just searched.
 */
type Upstream = InstanceType<typeof import('../clients/ai.js').AiUpstreamError>;
const INTERNAL = /10\.9\.8\.7|11434|qwen3|claude-x|AI_TIMEOUT_MS|AI_BASE_URL|ECONNREFUSED|out of memory|HTTP \d{3}/;
const enc = (text: string) => new TextEncoder().encode(text);

async function failureOf(run: () => Promise<unknown>): Promise<Upstream> {
  try {
    await run();
  } catch (err) {
    return err as Upstream;
  }
  throw new Error('expected the model call to fail, but it gave an answer');
}

async function drain(pieces: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const piece of pieces) text += piece;
  return text;
}

const OLLAMA_NATIVE = { ...LOCAL_ENV, AI_OLLAMA_NATIVE: 'true' };
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body));
const completionOf = (content: string) => jsonResponse({ choices: [{ message: { content } }] });

describe('an explanation the model fails to give', () => {
  const cases: {
    name: string;
    env: Record<string, string>;
    reply: () => Response;
    sentence: 'failed' | 'unusable';
    detail: RegExp;
  }[] = [
    {
      name: 'a native Ollama error body',
      env: OLLAMA_NATIVE,
      reply: () => jsonResponse({ error: 'model requires more system memory, out of memory' }),
      sentence: 'failed',
      detail: /out of memory/,
    },
    {
      name: 'a native Ollama reply with no text',
      env: OLLAMA_NATIVE,
      reply: () => jsonResponse({ message: { content: '' } }),
      sentence: 'unusable',
      detail: /returned no content/,
    },
    {
      name: 'an OpenAI-style reply with no choices',
      env: LOCAL_ENV,
      reply: () => jsonResponse({ choices: [] }),
      sentence: 'unusable',
      detail: /returned no content/,
    },
    {
      name: 'text that is not JSON',
      env: LOCAL_ENV,
      reply: () => completionOf('Sure! Here is the explanation.'),
      sentence: 'unusable',
      detail: /did not return valid JSON/,
    },
    {
      name: 'JSON with an empty field',
      env: LOCAL_ENV,
      reply: () => completionOf(JSON.stringify({ summary: ' ', tagsExplained: [{}], actionable: 'x' })),
      sentence: 'unusable',
      detail: /returned an empty summary/,
    },
  ];

  for (const c of cases) {
    it(`tells the viewer the fixed sentence for ${c.name}`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => c.reply()));
      const { humanize, AI_MESSAGE, AiUpstreamError } = await loadAi(c.env);

      const failure = await failureOf(() => humanize('problem', {}));

      expect(failure).toBeInstanceOf(AiUpstreamError);
      expect(failure.message).toBe(AI_MESSAGE[c.sentence]);
      expect(failure.message).not.toMatch(INTERNAL);
      expect(failure.detail).toMatch(c.detail);
    });
  }

  it('does the same when the hosted model returns no text block', async () => {
    const { humanize, getAnthropic, AI_MESSAGE } = await loadAi({
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      AI_MODEL: 'claude-x',
    });
    // @ts-expect-error a bare reply is enough: only `content` is read
    vi.spyOn(getAnthropic().messages, 'create').mockResolvedValue({ content: [{ type: 'tool_use' }] });

    const failure = await failureOf(() => humanize('problem', {}));

    expect(failure.message).toBe(AI_MESSAGE.unusable);
    expect(failure.message).not.toMatch(INTERNAL);
    expect(failure.detail).toMatch(/claude-x returned no text block/);
  });

  it('does the same when the hosted model rejects the request', async () => {
    const { humanize, getAnthropic, AI_MESSAGE } = await loadAi({
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      AI_MODEL: 'claude-x',
    });
    vi.spyOn(getAnthropic().messages, 'create').mockRejectedValue(
      Anthropic.APIError.generate(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limit for claude-x' } },
        undefined,
        new Headers(),
      ),
    );

    const failure = await failureOf(() => humanize('problem', {}));

    expect(failure.message).toBe(AI_MESSAGE.failed);
    expect(failure.message).not.toMatch(INTERNAL);
    expect(failure.detail).toMatch(/rate limit for claude-x/);
  });
});

describe('an Assistant answer the model fails to give', () => {
  const ask = (chat: typeof import('../services/assistant.js'), signal?: AbortSignal) =>
    drain(chat.streamAnswer([{ role: 'user', content: 'What is down?' }], 'SNAPSHOT', signal));

  it('says "stopped" for a native stream that ends before its done line, and keeps the model for the log', async () => {
    const { readOllamaStream, AI_MESSAGE } = await loadAi(OLLAMA_NATIVE);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc(`${JSON.stringify({ message: { content: 'Two hosts' }, done: false })}\n`));
        c.close();
      },
    });

    const failure = await failureOf(() => drain(readOllamaStream(body)));

    expect(failure.message).toBe(AI_MESSAGE.stopped);
    expect(failure.message).not.toMatch(INTERNAL);
    expect(failure.detail).toMatch(/qwen3:8b ended its stream before the done line/);
  });

  for (const [name, env] of [
    ['an OpenAI-style', LOCAL_ENV],
    ['a native Ollama', OLLAMA_NATIVE],
  ] as const) {
    it(`says "unusable" when ${name} server answers with no body`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null } as unknown as Response));
      const { AI_MESSAGE } = await loadAi(env);
      const chat = await import('../services/assistant.js');

      const failure = await failureOf(() => ask(chat));

      expect(failure.message).toBe(AI_MESSAGE.unusable);
      expect(failure.message).not.toMatch(INTERNAL);
      expect(failure.detail).toMatch(/qwen3:8b: HTTP 200 empty response/);
    });
  }

  it('says "too long", not the setting to raise, when the timeout hits part-way through an answer', async () => {
    // A server that sends a first piece and then goes quiet; the body errors when the request is aborted.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc('data: {"choices":[{"delta":{"content":"Two hosts"}}]}\n\n'));
            init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason), { once: true });
          },
        });
        return new Response(body);
      }),
    );
    const { AI_MESSAGE } = await loadAi({ ...LOCAL_ENV, AI_TIMEOUT_MS: '150' });
    const chat = await import('../services/assistant.js');

    const failure = await failureOf(() => ask(chat));

    expect(failure.message).toBe(AI_MESSAGE.timeout);
    expect(failure.message).not.toMatch(INTERNAL);
    expect(failure.detail).toMatch(/AI_TIMEOUT_MS/);
  });

  it('leaves a reader who pressed Stop alone: no AiUpstreamError, no sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason), { once: true });
          },
        });
        return new Response(body);
      }),
    );
    const { AiUpstreamError } = await loadAi({ ...LOCAL_ENV, AI_TIMEOUT_MS: '60000' });
    const chat = await import('../services/assistant.js');
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 30);

    const failure = await failureOf(() => ask(chat, stop.signal));

    expect(failure).not.toBeInstanceOf(AiUpstreamError);
  });

  it('gives a hosted model that fails mid-answer its fixed sentence', async () => {
    const { AI_MESSAGE, getAnthropic } = await loadAi({
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      AI_MODEL: 'claude-x',
    });
    const chat = await import('../services/assistant.js');
    // A bare stub of the SDK's stream is enough: it is only iterated.
    vi.spyOn(getAnthropic().messages, 'stream').mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Anthropic.APIConnectionError({ message: 'getaddrinfo ENOTFOUND api.anthropic.com' });
          },
        };
      },
    }));

    const failure = await failureOf(() => ask(chat));

    expect(failure.message).toBe(AI_MESSAGE.unreachable);
    expect(failure.message).not.toMatch(INTERNAL);
    expect(failure.detail).toMatch(/ENOTFOUND/);
  });
});

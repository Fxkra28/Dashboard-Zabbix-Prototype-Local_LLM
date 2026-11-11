import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The OpenAI-compatible backend (`AI_PROVIDER=openai-compatible`), which runs the plain-language
 * layer against a model on this host instead of a hosted API.
 *
 * Two things make it worth covering. It is hand-rolled `fetch` rather than a vendored SDK, so the
 * request shape is our responsibility, in particular the schema, which is the only reason the
 * caller can `JSON.parse` without a validation dependency. And `config` is a module-level singleton
 * read at import, so the provider switch exists only at import time: a test that forgets
 * `vi.resetModules()` silently exercises whichever backend `server/.env` happens to select on this
 * machine.
 */

const LOCAL_ENV = {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: 'http://localhost:11434/v1',
  AI_MODEL: 'qwen3:8b',
  // These tests are about the /v1 dialect; `auto` would spend the first fetch on a probe.
  AI_OLLAMA_NATIVE: 'false',
};

/** The same server spoken to natively, with every option stated so server/.env cannot leak in. */
const NATIVE_ENV = {
  ...LOCAL_ENV,
  AI_OLLAMA_NATIVE: 'auto',
  AI_KEEP_ALIVE: '30m',
  AI_NUM_CTX: '8192',
  AI_TEMPERATURE: '0.7',
  AI_TOP_P: '0.8',
};

/** A response that satisfies PROBLEM_SCHEMA's `required` in full. */
const OK_PROBLEM = {
  summary: 'A network link went down.',
  tagsExplained: [{ tag: 'site', value: 'platform-a', meaning: 'Which site it is at.' }],
  businessImpact: 'One platform lost a link.',
  recommendation: 'Check the switch port.',
};

/** Import `ai.ts` fresh, with `env` applied to the `config` it captures. */
async function loadAi(env: Record<string, string>) {
  vi.resetModules();
  // dotenv does not overwrite variables that are already set, so these win over
  // whatever server/.env holds on the machine running the suite.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('../clients/ai.js');
}

/** Shape an OpenAI chat-completions envelope around whatever the model "said". */
function completion(content: unknown) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return { choices: [{ message: { content: text } }] };
}

function stubFetch(body: unknown, { ok = true, status = 200 } = {}) {
  const mock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function bodyOf(mock: ReturnType<typeof vi.fn>) {
  return JSON.parse((mock.mock.calls[0][1] as RequestInit).body as string);
}

/** Newline-delimited JSON, as Ollama streams it. */
const ndjson = (...lines: unknown[]) => lines.map((l) => `${JSON.stringify(l)}\n`).join('');

/** A byte stream delivered in the given chunks. */
function chunked(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const piece of gen) out += piece;
  return out;
}

/**
 * A local Ollama: `/api/version` answers `version`, `/api/chat` answers a
 * streamed chat with NDJSON and anything else with one JSON reply. Every
 * request body is kept, by URL, for the assertions.
 */
function stubOllama({ version = '0.33.3' as unknown } = {}) {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version }));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push({ url, body });
    if (body.stream) {
      return new Response(
        ndjson(
          { message: { content: 'Nothing is down.' }, done: false },
          { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 3000, eval_count: 5 },
        ),
      );
    }
    return new Response(JSON.stringify({ message: { content: JSON.stringify(OK_PROBLEM) }, done: true }));
  });
  vi.stubGlobal('fetch', mock);
  return { mock, bodies };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('humanize: openai-compatible backend', () => {
  it('posts the schema the caller will parse against', async () => {
    const fetchMock = stubFetch(completion(OK_PROBLEM));
    const { humanize } = await loadAi(LOCAL_ENV);

    await humanize('problem', { host: 'PLT-A-SW-01' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    const body = bodyOf(fetchMock);
    expect(body.model).toBe('qwen3:8b');
    // Without this the response is unparseable and the 'no validation
    // dependency' claim in ai.ts stops being true.
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.required).toContain('tagsExplained');
  });

  it('parses a well-formed answer', async () => {
    stubFetch(completion(OK_PROBLEM));
    const { humanize } = await loadAi(LOCAL_ENV);
    await expect(humanize('problem', {})).resolves.toEqual(OK_PROBLEM);
  });

  it('turns reasoning off for thinking models, and only for them', async () => {
    // Measured on Ollama 0.33: left alone, qwen3:8b reasons for ~1 000
    // characters before every answer: 15 s instead of 3 s. The prompt-token
    // approach (`/no_think`) does not work there; see thinkingControl().
    const qwen = stubFetch(completion(OK_PROBLEM));
    const { humanize } = await loadAi(LOCAL_ENV);
    await humanize('problem', {});
    expect(bodyOf(qwen).reasoning_effort).toBe('none');
    expect(bodyOf(qwen).messages[0].content).not.toContain('/no_think');

    const other = stubFetch(completion(OK_PROBLEM));
    const mod = await loadAi({ ...LOCAL_ENV, AI_MODEL: 'llama3.1:8b' });
    await mod.humanize('problem', {});
    expect(bodyOf(other).reasoning_effort).toBeUndefined();
  });

  it('sends no Authorization header when there is no key, as a local Ollama expects', async () => {
    const fetchMock = stubFetch(completion(OK_PROBLEM));
    const { humanize } = await loadAi(LOCAL_ENV);
    await humanize('problem', {});
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('reports an unreachable model rather than leaking a fetch TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { humanize, AiUpstreamError } = await loadAi(LOCAL_ENV);
    await expect(humanize('problem', {})).rejects.toBeInstanceOf(AiUpstreamError);
  });

  it('maps a timeout onto AiUpstreamError, the way zabbix.ts does', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const { humanize, AiUpstreamError } = await loadAi(LOCAL_ENV);
    await expect(humanize('problem', {})).rejects.toThrow(AiUpstreamError);
  });

  it('rejects an HTTP error from the model server', async () => {
    stubFetch({ error: 'model not found' }, { ok: false, status: 404 });
    const { humanize, AiUpstreamError } = await loadAi(LOCAL_ENV);
    await expect(humanize('problem', {})).rejects.toBeInstanceOf(AiUpstreamError);
  });

  it('rejects a schema-shaped answer the model left empty', async () => {
    // A small model can satisfy the grammar with blank strings. Rendering that
    // would look like a portal bug, so it fails as an upstream error instead.
    stubFetch(completion({ ...OK_PROBLEM, summary: '   ' }));
    const { humanize, AiUpstreamError } = await loadAi(LOCAL_ENV);
    // The viewer gets the fixed sentence; what was empty is for the log (`detail`).
    const failure = (await humanize('problem', {}).catch((e: unknown) => e)) as InstanceType<typeof AiUpstreamError>;
    expect(failure).toBeInstanceOf(AiUpstreamError);
    expect(failure.message).not.toMatch(/summary|qwen/);
    expect(failure.detail).toMatch(/empty summary/);
  });

  it('rejects non-JSON, which is what an unconstrained model returns', async () => {
    stubFetch(completion('Sure! Here is the explanation you asked for.'));
    const { humanize, AiUpstreamError } = await loadAi(LOCAL_ENV);
    await expect(humanize('problem', {})).rejects.toBeInstanceOf(AiUpstreamError);
  });
});

describe('humanize: configuration', () => {
  it('is disabled with no AI_BASE_URL, so the UI hides the button instead of offering a 502', async () => {
    const { humanize, AiDisabledError } = await loadAi({
      AI_PROVIDER: 'openai-compatible',
      AI_BASE_URL: '',
      ANTHROPIC_API_KEY: 'sk-ant-irrelevant-to-this-backend',
    });
    await expect(humanize('problem', {})).rejects.toBeInstanceOf(AiDisabledError);
  });

  it('is enabled by a base URL alone: a local model has no key to check', async () => {
    vi.resetModules();
    vi.stubEnv('AI_PROVIDER', 'openai-compatible');
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { config } = await import('../core/config.js');
    expect(config.ai.enabled).toBe(true);
  });
});

describe('warmModel', () => {
  it("loads the model through Ollama's native /api/generate with keep_alive", async () => {
    const fetchMock = stubFetch({ done: true });
    const { warmModel } = await loadAi({ ...LOCAL_ENV, AI_KEEP_ALIVE: '30m' });

    await warmModel();

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
    expect(bodyOf(fetchMock)).toEqual({ model: 'qwen3:8b', prompt: '', keep_alive: '30m' });
  });

  it('never throws: a failed warm-up only means a slower first answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { warmModel } = await loadAi(LOCAL_ENV);
    const debug = vi.fn();
    await expect(warmModel({ debug })).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalled();
  });

  it('does nothing for the hosted backend', async () => {
    const fetchMock = stubFetch({});
    const { warmModel } = await loadAi({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });
    await warmModel();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('usesOllamaNative: AI_OLLAMA_NATIVE=auto', () => {
  it('asks {root}/api/version once and speaks Ollama when it answers with a string version', async () => {
    const { mock } = stubOllama();
    const { usesOllamaNative } = await loadAi(NATIVE_ENV);

    await expect(usesOllamaNative()).resolves.toBe(true);
    await expect(usesOllamaNative()).resolves.toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('http://localhost:11434/api/version');
  });

  it('keeps /v1 for a server that answers without a string version, and remembers that', async () => {
    const { mock } = stubOllama({ version: 33 });
    const { usesOllamaNative } = await loadAi(NATIVE_ENV);
    await expect(usesOllamaNative()).resolves.toBe(false);
    await expect(usesOllamaNative()).resolves.toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);

    // vLLM and llama.cpp have no such route: a 404 is an answer too.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('404 page not found', { status: 404 })));
    const other = await loadAi(NATIVE_ENV);
    await expect(other.usesOllamaNative()).resolves.toBe(false);
  });

  it('asks again after a probe that got no answer, so an Ollama started later is still found', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(new Response(JSON.stringify({ version: '0.33.3' })));
    vi.stubGlobal('fetch', mock);
    const { usesOllamaNative } = await loadAi(NATIVE_ENV);

    await expect(usesOllamaNative()).resolves.toBe(false);
    await expect(usesOllamaNative()).resolves.toBe(true);
    await expect(usesOllamaNative()).resolves.toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not probe when the setting says, or for the hosted backend', async () => {
    const { mock } = stubOllama();
    expect(await (await loadAi({ ...NATIVE_ENV, AI_OLLAMA_NATIVE: 'true' })).usesOllamaNative()).toBe(true);
    expect(await (await loadAi(LOCAL_ENV)).usesOllamaNative()).toBe(false);
    expect(await (await loadAi({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).usesOllamaNative()).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('native Ollama requests', () => {
  it('explains through /api/chat with the schema, think:false, keep_alive and explicit sampling', async () => {
    const { bodies } = stubOllama();
    const { humanize } = await loadAi(NATIVE_ENV);

    await expect(humanize('problem', { host: 'PLT-A-SW-01' })).resolves.toEqual(OK_PROBLEM);

    expect(bodies).toHaveLength(1);
    const { url, body } = bodies[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(body).toMatchObject({
      model: 'qwen3:8b',
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { num_ctx: 8192, num_predict: 2048, temperature: 0.7, top_p: 0.8 },
    });
    expect((body.format as { required: string[] }).required).toContain('tagsExplained');
  });

  it('sends chat, explain, warm-up and prefill the same runner options, so none restarts the model', async () => {
    // num_ctx is a flag of Ollama's runner process: one request with another
    // value restarts it and drops the prompt cache the next question needs.
    const { bodies } = stubOllama();
    const { humanize, warmModel, prefillModel } = await loadAi(NATIVE_ENV);
    const { streamAnswer } = await import('../services/assistant.js');

    expect(await collect(streamAnswer([{ role: 'user', content: 'Ada yang down?' }], 'SNAPSHOT'))).toBe('Nothing is down.');
    await humanize('problem', {});
    await warmModel();
    await expect(prefillModel('SYSTEM')).resolves.toBe(true);

    expect(bodies.map((b) => b.url)).toEqual(Array(4).fill('http://localhost:11434/api/chat'));
    const runner = ({ body }: (typeof bodies)[number]) => {
      const { num_predict: _limit, ...options } = body.options as Record<string, unknown>;
      return { model: body.model, think: body.think, keep_alive: body.keep_alive, options };
    };
    for (const b of bodies) expect(runner(b)).toEqual(runner(bodies[0]));
    expect(runner(bodies[0]).options).toEqual({ num_ctx: 8192, temperature: 0.7, top_p: 0.8 });

    // Only the output limit differs: an answer, an explanation, a load, one token.
    expect(bodies.map((b) => (b.body.options as { num_predict: number }).num_predict)).toEqual([700, 2048, 1, 1]);
    expect(bodies[0].body.stream).toBe(true);
    expect(bodies[2].body.messages).toEqual([]);
    expect(bodies[3].body.messages).toEqual([{ role: 'system', content: 'SYSTEM' }]);
  });

  it('keeps the snapshot a byte-identical prefix of the system text, with per-question lines after it', async () => {
    const { bodies } = stubOllama();
    await loadAi(NATIVE_ENV);
    const { streamAnswer, systemText } = await import('../services/assistant.js');

    await collect(streamAnswer([{ role: 'user', content: 'Ada yang down di MOPU?' }], 'SNAP', undefined, { focus: 'FOCUS: MOPU / MAC' }));
    await collect(streamAnswer([{ role: 'user', content: 'Which sites missed SLA?' }], 'SNAP'));

    const [first, second] = bodies.map((b) => (b.body.messages as { content: string }[])[0].content);
    expect(first.startsWith(`${systemText('SNAP')}\n\nFOCUS: MOPU / MAC\n\n`)).toBe(true);
    expect(first).toMatch(/Reply in Bahasa Indonesia/);
    expect(second.startsWith(`${systemText('SNAP')}\n\nThe user's latest message is in English`)).toBe(true);
  });

  it('skips the prefill, rather than queueing it, while another request holds the model', async () => {
    const { bodies } = stubOllama();
    const { prefillModel, tryAcquireModelSlot } = await loadAi(NATIVE_ENV);

    const release = tryAcquireModelSlot();
    expect(release).not.toBeNull();
    await expect(prefillModel('SYSTEM')).resolves.toBe(false);
    expect(bodies).toHaveLength(0);

    release?.();
    await expect(prefillModel('SYSTEM')).resolves.toBe(true);
    expect(bodies).toHaveLength(1);
  });
});

describe('readOllamaStream', () => {
  it('joins content from lines split across chunks and reports the final counts', async () => {
    const { readOllamaStream } = await loadAi(NATIVE_ENV);
    const text = ndjson(
      { message: { content: 'Tidak ada ' }, done: false },
      { message: { content: 'yang down.' }, done: false },
      { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 3120, prompt_eval_cached_count: 3050, eval_count: 42, load_duration: 2_000_000 },
    );
    const onDone = vi.fn();
    const body = chunked(text.slice(0, 17), text.slice(17, 60), text.slice(60));

    expect(await collect(readOllamaStream(body, onDone))).toBe('Tidak ada yang down.');
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ doneReason: 'stop', promptEvalCount: 3120, promptCachedCount: 3050, evalCount: 42, loadMs: 2 }),
    );
  });

  it('turns an error line into AiUpstreamError, after the text that came before it', async () => {
    const { readOllamaStream, AiUpstreamError } = await loadAi(NATIVE_ENV);
    const body = chunked(ndjson({ message: { content: 'Part' }, done: false }, { error: 'model runner has unexpectedly stopped' }));

    let text = '';
    const run = async () => {
      for await (const piece of readOllamaStream(body)) text += piece;
    };
    await expect(run()).rejects.toThrow(AiUpstreamError);
    expect(text).toBe('Part');
  });

  it('fails a stream that ends before its done line instead of passing off a cut-off answer', async () => {
    const { readOllamaStream, AiUpstreamError } = await loadAi(NATIVE_ENV);
    const body = chunked(ndjson({ message: { content: 'Half an' }, done: false }));
    await expect(collect(readOllamaStream(body))).rejects.toBeInstanceOf(AiUpstreamError);
  });
});

describe('one model request at a time', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('makes a second request wait for the first, then serves them in order', async () => {
    const { acquireModelSlot, tryAcquireModelSlot } = await loadAi(LOCAL_ENV);
    const order: string[] = [];

    const first = await acquireModelSlot();
    const second = acquireModelSlot().then((release) => (order.push('second'), release));
    const third = acquireModelSlot().then((release) => (order.push('third'), release));
    await tick();
    expect(order).toEqual([]);
    expect(tryAcquireModelSlot()).toBeNull();

    first();
    (await second)();
    (await third)();
    expect(order).toEqual(['second', 'third']);
    // Released twice is still released once.
    first();
    expect(tryAcquireModelSlot()).not.toBeNull();
  });

  it('tells a request that waits too long that the assistant is busy, and frees its place', async () => {
    const { acquireModelSlot, tryAcquireModelSlot, AiBusyError, AiUpstreamError, BUSY_MESSAGE } = await loadAi(LOCAL_ENV);
    const holder = await acquireModelSlot();

    const waiting = acquireModelSlot(undefined, 20);
    await expect(waiting).rejects.toBeInstanceOf(AiBusyError);
    await expect(waiting).rejects.toBeInstanceOf(AiUpstreamError);
    await expect(waiting).rejects.toThrow(BUSY_MESSAGE);

    holder();
    expect(tryAcquireModelSlot()).not.toBeNull();
  });

  it('answers "busy" as a retryable 503, not as a 502 model failure', async () => {
    const { AiBusyError, AiUpstreamError, BUSY_MESSAGE } = await loadAi(LOCAL_ENV);
    // Same module registry as loadAi, so errors.ts sees the same classes.
    const { buildTestApp } = await import('./helpers/app.js');
    const app = await buildTestApp(async (a) => {
      a.get('/busy', async () => {
        throw new AiBusyError(BUSY_MESSAGE);
      });
      a.get('/failed', async () => {
        throw new AiUpstreamError('model unreachable');
      });
    });

    const busy = await app.inject({ url: '/busy' });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('10');
    expect(busy.json()).toEqual({ error: 'ai_busy', message: BUSY_MESSAGE });
    expect((await app.inject({ url: '/failed' })).json()).toMatchObject({ error: 'ai_error' });
    await app.close();
  });

  it('lets a reader who leaves give up their place', async () => {
    const { acquireModelSlot, tryAcquireModelSlot } = await loadAi(LOCAL_ENV);
    const holder = await acquireModelSlot();
    const ac = new AbortController();

    const waiting = acquireModelSlot(ac.signal);
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

    holder();
    expect(tryAcquireModelSlot()).not.toBeNull();
  });

  it('holds an explanation until the model is free, and says "busy" after ~20 s instead of timing out', async () => {
    const fetchMock = stubFetch(completion(OK_PROBLEM));
    const { humanize, tryAcquireModelSlot, BUSY_MESSAGE } = await loadAi(LOCAL_ENV);

    const release = tryAcquireModelSlot();
    const waiting = humanize('problem', {});
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    release?.();
    await expect(waiting).resolves.toEqual(OK_PROBLEM);

    vi.useFakeTimers();
    tryAcquireModelSlot();
    const busy = humanize('problem', {});
    const settled = expect(busy).rejects.toThrow(BUSY_MESSAGE);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
  });
});

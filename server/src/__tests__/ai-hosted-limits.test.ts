import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The model side of the AI caps (limits.ts). The hosted API gets the cap the local model's single
 * slot already gave it (AI_MAX_CONCURRENT calls in flight, the next one waits), and what a hosted
 * call is billed is reported once so the daily budget can charge it. The local model's path is
 * unchanged: its own slot, no hosted pool, no token count. The Anthropic SDK and `fetch` are
 * stand-ins.
 */

const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    messages = { create: sdk.create, stream: sdk.stream };
  }
  return { default: Anthropic };
});

const HOSTED = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'fake-key-for-tests', AI_MAX_CONCURRENT: '2' };
const LOCAL = {
  AI_PROVIDER: 'openai-compatible',
  AI_BASE_URL: 'http://localhost:11434/v1',
  AI_OLLAMA_NATIVE: 'false',
  AI_MAX_CONCURRENT: '1',
};

/** `ai.ts` and `services/assistant.ts` fresh, with `env` applied to the `config` they capture. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  // Nothing from the machine running the tests may leak into the case.
  for (const name of ['AI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_BASE_URL', 'AI_TIMEOUT_MS']) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const [ai, chat] = await Promise.all([import('../clients/ai.js'), import('../services/assistant.js')]);
  return { ...ai, ...chat };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sdk.create.mockReset();
  sdk.stream.mockReset();
});

const sleep = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** What `messages.create` answers: a valid explanation, and the usage the API reports. */
const message = (usage?: Record<string, number>) => ({
  content: [{ type: 'text', text: JSON.stringify({ summary: 's', tagsExplained: [], businessImpact: 'b', recommendation: 'r' }) }],
  ...(usage ? { usage } : {}),
});

/** What `messages.stream` returns: an async iterable of the events the API sends. */
const events = (...list: unknown[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const event of list) yield event;
  },
});
const start = (usage: Record<string, number>) => ({ type: 'message_start', message: { usage } });
const text = (t: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
const finish = (output: number) => ({ type: 'message_delta', usage: { output_tokens: output } });

const TURNS = [{ role: 'user' as const, content: 'What is wrong?' }];

describe('acquireHostedSlot', () => {
  it('lets AI_MAX_CONCURRENT calls hold a slot, makes the next wait, and hands a freed slot straight on', async () => {
    const { acquireHostedSlot } = await load(HOSTED);
    const first = await acquireHostedSlot();
    const second = await acquireHostedSlot();

    let granted = false;
    const third = acquireHostedSlot().then((release) => {
      granted = true;
      return release;
    });
    await sleep();
    expect(granted).toBe(false);

    first();
    const release = await third;
    expect(granted).toBe(true);

    // Handed on, not freed: a fourth still waits while two hold slots.
    let fourth = false;
    void acquireHostedSlot().then(() => (fourth = true));
    await sleep();
    expect(fourth).toBe(false);

    second();
    await sleep();
    expect(fourth).toBe(true);
    release();
  });

  it('frees a slot once however often release is called', async () => {
    const { acquireHostedSlot } = await load({ ...HOSTED, AI_MAX_CONCURRENT: '1' });
    const release = await acquireHostedSlot();
    release();
    release();
    const a = await acquireHostedSlot();
    let b = false;
    void acquireHostedSlot().then(() => (b = true));
    await sleep();
    expect(b).toBe(false); // the double release did not open a second slot
    a();
  });

  it('tells a call that waits too long the assistant is busy, in the words and type the local model uses', async () => {
    const { acquireHostedSlot, AiBusyError, BUSY_MESSAGE } = await load({ ...HOSTED, AI_MAX_CONCURRENT: '1' });
    const held = await acquireHostedSlot();
    const waiting = acquireHostedSlot(undefined, 15);
    await expect(waiting).rejects.toBeInstanceOf(AiBusyError);
    await expect(waiting).rejects.toThrow(BUSY_MESSAGE);
    held();
  });

  it('gives up its place when the reader leaves, and does not take the slot afterwards', async () => {
    const { acquireHostedSlot } = await load({ ...HOSTED, AI_MAX_CONCURRENT: '1' });
    const held = await acquireHostedSlot();
    const gone = new AbortController();
    const waiting = acquireHostedSlot(gone.signal);
    gone.abort(new Error('reader left'));
    await expect(waiting).rejects.toThrow('reader left');

    held();
    const next = await acquireHostedSlot(); // the slot is free, not held by the one who left
    next();
    await expect(acquireHostedSlot(gone.signal)).rejects.toThrow('reader left');
  });
});

describe('Explain on the hosted API', () => {
  it('runs at most AI_MAX_CONCURRENT calls at once and starts the next as one finishes', async () => {
    const pending: ((m: unknown) => void)[] = [];
    sdk.create.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { humanize } = await load(HOSTED);

    const calls = [1, 2, 3, 4].map((n) => humanize('problem', { n }));
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalledTimes(2));
    await sleep();
    expect(sdk.create).toHaveBeenCalledTimes(2);

    pending[0](message());
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalledTimes(3));
    pending[1](message());
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalledTimes(4));
    pending[2](message());
    pending[3](message());
    await expect(Promise.all(calls)).resolves.toHaveLength(4);
  });

  it('frees the slot when a call fails, so one failure does not shrink the cap', async () => {
    sdk.create.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(message());
    const { humanize } = await load({ ...HOSTED, AI_MAX_CONCURRENT: '1' });
    await expect(humanize('problem', {})).rejects.toThrow('boom');
    await expect(humanize('problem', {})).resolves.toMatchObject({ summary: 's' });
  });

  it('reports what the API billed, cache included, once', async () => {
    sdk.create.mockResolvedValue(message({ input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 }));
    const { humanize } = await load(HOSTED);
    const onUsage = vi.fn();
    await humanize('problem', {}, onUsage);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(500);
  });

  it('charges an answer that came with no count by the size of the question, never nothing', async () => {
    sdk.create.mockResolvedValue(message());
    const { humanize } = await load(HOSTED);
    const onUsage = vi.fn();
    await humanize('problem', { host: 'x'.repeat(4_000) }, onUsage);
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage.mock.calls[0][0]).toBeGreaterThan(1_000);
  });

  it('charges nothing when the API refused the call', async () => {
    sdk.create.mockRejectedValue(new Error('no'));
    const { humanize } = await load(HOSTED);
    const onUsage = vi.fn();
    await expect(humanize('problem', {}, onUsage)).rejects.toThrow('no');
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe('the Assistant on the hosted API', () => {
  it('reports the tokens the stream said it used: input from its start, output from its end', async () => {
    sdk.stream.mockReturnValue(
      events(start({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 20 }), text('Hello'), text(' there'), finish(50)),
    );
    const { streamAnswer } = await load(HOSTED);
    const onUsage = vi.fn();
    let answer = '';
    for await (const piece of streamAnswer(TURNS, 'SNAPSHOT', undefined, { onUsage })) answer += piece;
    expect(answer).toBe('Hello there');
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(170);
  });

  it('charges a reader who stops early for what was read, and the answer so far by its size', async () => {
    sdk.stream.mockReturnValue(events(start({ input_tokens: 100, output_tokens: 1 }), text('Hello'), text(' there'), finish(50)));
    const { streamAnswer } = await load(HOSTED);
    const onUsage = vi.fn();
    const answer = streamAnswer(TURNS, 'SNAPSHOT', undefined, { onUsage });
    await answer.next(); // 'Hello'
    await answer.return(undefined); // the reader pressed Stop
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(100 + 2); // 5 characters is 2 tokens
  });

  it('charges nothing for a call that never started', async () => {
    sdk.stream.mockReturnValue({
      // eslint-disable-next-line require-yield -- a stream that fails before its first event
      async *[Symbol.asyncIterator]() {
        throw new Error('no connection');
      },
    });
    const { streamAnswer } = await load(HOSTED);
    const onUsage = vi.fn();
    await expect(async () => {
      for await (const piece of streamAnswer(TURNS, 'SNAPSHOT', undefined, { onUsage })) void piece;
    }).rejects.toThrow('no connection');
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('holds a hosted slot while it streams, so the cap covers the Assistant too', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    sdk.stream.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await gate;
        yield text('done');
      },
    }));
    const { streamAnswer } = await load({ ...HOSTED, AI_MAX_CONCURRENT: '1' });

    // An answer holds its slot until it ends, so each is read to the end.
    const drain = async (answer: AsyncGenerator<string>) => {
      for await (const piece of answer) void piece;
    };
    const first = drain(streamAnswer(TURNS, 'SNAPSHOT'));
    await vi.waitFor(() => expect(sdk.stream).toHaveBeenCalledTimes(1));
    const second = drain(streamAnswer(TURNS, 'SNAPSHOT'));
    await sleep();
    expect(sdk.stream).toHaveBeenCalledTimes(1); // waiting its turn

    open();
    await first;
    await second;
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });
});

describe('the local model keeps the path it had', () => {
  const answer = (content: string) =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;
  const EXPLANATION = JSON.stringify({ summary: 's', tagsExplained: [], businessImpact: 'b', recommendation: 'r' });

  it('is not held up by a full hosted pool, and reports no tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(EXPLANATION));
    vi.stubGlobal('fetch', fetchMock);
    const { humanize, acquireHostedSlot } = await load(LOCAL);
    const held = await acquireHostedSlot(); // the whole hosted pool (AI_MAX_CONCURRENT is 1)

    const onUsage = vi.fn();
    await expect(humanize('problem', {}, onUsage)).resolves.toMatchObject({ summary: 's' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sdk.create).not.toHaveBeenCalled();
    expect(onUsage).not.toHaveBeenCalled();
    held();
  });

  it('still answers one question at a time through its own slot', async () => {
    const release: (() => void)[] = [];
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => release.push(() => resolve(answer(EXPLANATION)))));
    vi.stubGlobal('fetch', fetchMock);
    const { humanize } = await load({ ...LOCAL, AI_MAX_CONCURRENT: '4' }); // a high hosted cap changes nothing here

    const first = humanize('problem', {});
    const second = humanize('problem', {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await sleep();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release[0]();
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release[1]();
    await second;
  });

  it('streams an answer without the hosted SDK and reports no tokens', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body } as unknown as Response));
    const { streamAnswer, acquireHostedSlot } = await load(LOCAL);
    const held = await acquireHostedSlot();

    const onUsage = vi.fn();
    let got = '';
    for await (const piece of streamAnswer(TURNS, 'SNAPSHOT', undefined, { onUsage })) got += piece;
    expect(got).toBe('Hi');
    expect(sdk.stream).not.toHaveBeenCalled();
    expect(onUsage).not.toHaveBeenCalled();
    held();
  });
});

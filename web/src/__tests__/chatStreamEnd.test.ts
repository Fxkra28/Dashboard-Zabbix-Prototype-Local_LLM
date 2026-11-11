import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Assistant's answer arrives as a stream of frames and ends with a closing `done` frame. A stream that ends without it was
 * cut off, and is a failure the person is told about, not a finished answer (FR-35).
 */

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const stream = (...chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

let fetchMock: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  return import('../api');
}
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

const ask = async (response: Response) => {
  const { chatStream } = await load();
  fetchMock.mockResolvedValueOnce(response);
  const tokens: string[] = [];
  const done = vi.fn();
  const run = chatStream([{ role: 'user', content: 'hi' }], { onToken: (t) => tokens.push(t), onDone: done });
  return { run, tokens, done };
};
const DONE = { usage: { input: 1, output: 2 } };

describe('the end of the Assistant’s stream', () => {
  it('is an answer when the closing frame comes, with every token before it', async () => {
    const { run, tokens, done } = await ask(stream(frame('token', { t: 'Hello' }), frame('token', { t: ' there' }), frame('done', DONE)));
    await expect(run).resolves.toBeUndefined();
    expect(tokens).toEqual(['Hello', ' there']);
    expect(done).toHaveBeenCalledWith(DONE);
  });

  it('is an answer when the closing frame arrives in the same piece as the last token', async () => {
    const { run, tokens, done } = await ask(stream(frame('token', { t: 'Hi' }) + frame('done', DONE)));
    await expect(run).resolves.toBeUndefined();
    expect(tokens).toEqual(['Hi']);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('is a failure, not a finished answer, when the stream ends without the closing frame', async () => {
    const { run, tokens, done } = await ask(stream(frame('token', { t: 'Half an ans' })));
    await expect(run).rejects.toThrow('The answer was cut off before it finished. Ask again.');
    expect(tokens).toEqual(['Half an ans']);
    expect(done).not.toHaveBeenCalled();
  });

  it('is a failure when the stream ends at once, with nothing in it', async () => {
    const { run } = await ask(stream());
    await expect(run).rejects.toThrow('cut off');
  });

  it('is a failure when the last frame was only half sent', async () => {
    const { run, done } = await ask(stream(frame('token', { t: 'Hi' }), 'event: done\ndata: {"usa'));
    await expect(run).rejects.toThrow('cut off');
    expect(done).not.toHaveBeenCalled();
  });

  it('still fails with the portal’s own words when an error frame comes', async () => {
    const { run } = await ask(stream(frame('token', { t: 'Hi' }), frame('error', { message: 'The model is busy. Try again in a minute.' })));
    await expect(run).rejects.toThrow('The model is busy. Try again in a minute.');
  });
});

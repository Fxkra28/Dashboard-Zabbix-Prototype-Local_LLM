import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A request to the model is never passed on by a redirect (SC-70). A local proxy that answered 307 sent the body, the question and the estate summary, to an address that the
 * start-up check never saw. Both servers here are on this machine and made up.
 */
vi.hoisted(() => {
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.AI_BASE_URL = 'http://127.0.0.1:1/v1';
});

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

const listen = (handler: http.RequestListener) =>
  new Promise<number>((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

describe('postModel', () => {
  it('does not follow a redirect, so the body never reaches the address it names', async () => {
    const received: string[] = [];
    const elsewhere = await listen((req, res) => {
      req.on('data', (c: Buffer) => received.push(c.toString()));
      req.on('end', () => res.end('{}'));
    });
    const proxy = await listen((req, res) => {
      req.resume();
      res.writeHead(307, { location: `http://127.0.0.1:${elsewhere}/steal` });
      res.end();
    });
    const { postModel, AiUpstreamError } = await import('../clients/ai.js');
    await expect(postModel(`http://127.0.0.1:${proxy}/v1/chat/completions`, { messages: [{ role: 'user', content: 'a question and a summary of the estate' }] }, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(AiUpstreamError);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
  });

  it('still posts to a model that answers directly', async () => {
    const port = await listen((req, res) => {
      req.resume();
      req.on('end', () => res.end('{"ok":true}'));
    });
    const { postModel } = await import('../clients/ai.js');
    const res = await postModel(`http://127.0.0.1:${port}/v1/chat/completions`, { a: 1 }, AbortSignal.timeout(5_000));
    expect(await res.json()).toEqual({ ok: true });
  });
});

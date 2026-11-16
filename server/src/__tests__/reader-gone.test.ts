import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';
import { Cancelled } from '../core/gate.js';
import { readerGone } from '../core/readerGone.js';
import { buildTestApp } from './helpers/app.js';

/** The signal a route hands to a slow read: it fires when the reader's connection closes before the answer is out. */

function reply(raw: { writableFinished?: boolean; destroyed?: boolean } = {}) {
  const res = Object.assign(new EventEmitter(), { writableFinished: false, destroyed: false, ...raw });
  return { fastify: { raw: res } as unknown as FastifyReply, res };
}

describe('readerGone', () => {
  it('fires when the connection closes before the answer is out', () => {
    const { fastify, res } = reply();
    const signal = readerGone(fastify);
    expect(signal.aborted).toBe(false);
    res.emit('close');
    expect(signal.aborted).toBe(true);
  });

  it('does not fire when the response closes after it was sent in full', () => {
    const { fastify, res } = reply();
    const signal = readerGone(fastify);
    res.writableFinished = true;
    res.emit('close');
    expect(signal.aborted).toBe(false);
  });

  it('fires at once when the connection is already gone', () => {
    const { fastify } = reply({ destroyed: true });
    expect(readerGone(fastify).aborted).toBe(true);
  });

  it('does not fire for a response that finished and was torn down', () => {
    const { fastify } = reply({ destroyed: true, writableFinished: true });
    expect(readerGone(fastify).aborted).toBe(false);
  });
});

describe('a dropped read in the error handler', () => {
  it('is a 499 for a reader who is gone, not the 500 of an unexpected error', async () => {
    const app = await buildTestApp(async (a) => {
      a.get('/gone', () => {
        throw new Cancelled();
      });
    });
    const res = await app.inject({ url: '/gone' });
    expect(res.statusCode).toBe(499);
    expect(res.json()).toEqual({ error: 'cancelled', message: 'The read was dropped because its reader left.' });
    await app.close();
  });
});

import type { FastifyReply } from 'fastify';

/** A signal that fires when the reader's connection closes before the answer is out: the page moved on, or the tab closed. */
export function readerGone(reply: FastifyReply): AbortSignal {
  const ac = new AbortController();
  // The response's 'close', not the request's (a bodiless GET's never fires); it also fires after a complete answer, which is not a reader leaving.
  const res = reply.raw;
  if (res.destroyed && !res.writableFinished) ac.abort();
  else res.once('close', () => (res.writableFinished ? undefined : ac.abort()));
  return ac.signal;
}

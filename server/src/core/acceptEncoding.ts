/**
 * What a client's Accept-Encoding header allows. A coding's weight is its own `q` (1 when it has none), else the weight of `*`,
 * else 0; `q=0` means "not this one". Shared by the JSON compression hook and the live stream.
 */
export function codingWeight(header: string | string[] | undefined, coding: string): number {
  const weights = new Map<string, number>();
  for (const part of (Array.isArray(header) ? header.join(',') : header ?? '').split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    if (!name) continue;
    const q = params.find((p) => p.startsWith('q='));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    weights.set(name, Number.isFinite(weight) ? weight : 0);
  }
  return weights.get(coding) ?? weights.get('*') ?? 0;
}

/** Whether the client takes gzip, which is all a browser offers over plain HTTP. */
export const acceptsGzip = (header: string | string[] | undefined): boolean => codingWeight(header, 'gzip') > 0;

import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../core/config.js';
import { zonedDate, zonedDayStart } from '../sli/time.js';

/**
 * Per-user caps on the AI routes, which the global limit does not give: it is one bucket per
 * address. Calls a minute (every provider, Assistant and Explain counted apart), tokens a day (the
 * hosted API only, a local model has no bill), and in ai.ts hosted calls at once. Counts live in
 * memory, per BFF process: a restart gives everyone a fresh allowance.
 */

export type AiKind = 'chat' | 'explain';

/** Who a call counts against: the signed-in user, or the client address when auth is off (as services/stream.ts). */
export function callerOf(req: FastifyRequest): string {
  const sub = (req.user as { sub?: unknown } | undefined)?.sub;
  return typeof sub === 'string' && sub ? `user:${sub}` : `ip:${req.ip}`;
}

// Calls a minute

const WINDOW_MS = 60_000;
/** Bounds the table when every call comes from a new address (auth off). */
const MAX_KEYS = 5_000;

/** One fixed window per key, started by that key's first call: a minute unless told otherwise. */
export class MinuteLimit {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  /** Count a call: null when it may go ahead, else the seconds until this key's minute is over. */
  take(key: string): number | null {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.delete(key); // re-inserted, so the oldest key is always first
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.windows.size > MAX_KEYS) this.prune(now);
      return null;
    }
    if (window.count >= this.max) return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    window.count++;
    return null;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
    while (this.windows.size > MAX_KEYS) this.windows.delete(this.windows.keys().next().value as string);
  }
}

/** The same count over an hour. */
export class HourLimit extends MinuteLimit {
  constructor(max: number, now: () => number = Date.now) {
    super(max, now, 60 * WINDOW_MS);
  }
}

// Tokens a day

/** Roughly four characters to a token: for a call whose answer carried no count. */
export const estimatedTokens = (chars: number): number => Math.ceil(Math.max(0, chars) / 4);

export interface BudgetLimits {
  /** Tokens one caller may use a day; 0 is no limit. */
  perUser: number;
  /** Tokens everyone together may use a day; 0 is no limit. */
  total: number;
}

export interface BudgetRefusal {
  message: string;
  /** Seconds until the day rolls over. */
  retryAfter: number;
}

/** The calendar day of `nowMs` in `zone`, and the seconds left of it. An unknown zone reads as UTC. */
function dayIn(zone: string, nowMs: number): { key: string; secondsLeft: number } {
  const seconds = Math.floor(nowMs / 1000);
  for (const tz of [zone, 'UTC']) {
    try {
      const { year, month, day } = zonedDate(seconds, tz);
      return { key: `${year}-${month}-${day}`, secondsLeft: Math.max(1, zonedDayStart(year, month, day + 1, tz) - seconds) };
    } catch {
      // try the next zone
    }
  }
  return { key: String(Math.floor(seconds / 86_400)), secondsLeft: 86_400 - (seconds % 86_400) };
}

/** A wait in words a reader can use: "about 5 hours", "about 40 minutes". */
function inWords(seconds: number): string {
  if (seconds >= 5_400) return `about ${Math.round(seconds / 3_600)} hours`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Not a caller name (those start `user:` or `ip:`), so the portal total shares the table. */
const ALL = '*';

/** Tokens used today, by caller and in all, reset when the calendar day (in the portal's time zone) changes. */
export class DailyTokens {
  private day = '';
  private readonly used = new Map<string, number>();

  constructor(
    private readonly limits: () => BudgetLimits,
    private readonly zone: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  private today() {
    const today = dayIn(this.zone(), this.now());
    if (today.key !== this.day) {
      this.day = today.key;
      this.used.clear();
    }
    return today;
  }

  /** Why this caller may not start another call today, or null when they may. */
  refusal(caller: string): BudgetRefusal | null {
    const today = this.today();
    const { perUser, total } = this.limits();
    const zone = this.zone();
    if (perUser > 0 && (this.used.get(caller) ?? 0) >= perUser) {
      return {
        message:
          `You have used your share of AI answers for today. It starts again at midnight (${zone}), ` +
          `${inWords(today.secondsLeft)} from now. The rest of the portal still works.`,
        retryAfter: today.secondsLeft,
      };
    }
    if (total > 0 && (this.used.get(ALL) ?? 0) >= total) {
      return {
        message:
          `The portal has used all of its AI answers for today. It starts again at midnight (${zone}), ` +
          `${inWords(today.secondsLeft)} from now. The rest of the portal still works.`,
        retryAfter: today.secondsLeft,
      };
    }
    return null;
  }

  /** Charge a finished call to `caller` and to the portal total. */
  record(caller: string, tokens: number): void {
    if (!(tokens > 0)) return;
    this.today();
    this.used.set(caller, (this.used.get(caller) ?? 0) + tokens);
    this.used.set(ALL, (this.used.get(ALL) ?? 0) + tokens);
  }

  /** Tokens used today by `caller`, or by everyone when no caller is given. */
  usedBy(caller: string = ALL): number {
    this.today();
    return this.used.get(caller) ?? 0;
  }
}

const { limits } = config.ai;

const perMinute: Record<AiKind, MinuteLimit> = {
  chat: new MinuteLimit(limits.chatPerMinute),
  explain: new MinuteLimit(limits.explainPerMinute),
};
const WHAT: Record<AiKind, { max: number; unit: string }> = {
  chat: { max: limits.chatPerMinute, unit: 'questions to the assistant' },
  explain: { max: limits.explainPerMinute, unit: 'explanations' },
};

/** The portal's one budget, read from config.ts. */
export const aiBudget = new DailyTokens(
  () => ({ perUser: limits.dailyTokensPerUser, total: limits.dailyTokensTotal }),
  () => config.sla.timezone,
);

/** What to give `humanize` and `streamAnswer` so a finished call is charged to whoever asked. */
export const chargeTo = (req: FastifyRequest) => (tokens: number) => aiBudget.record(callerOf(req), tokens);

/**
 * The route guard for an AI route: too many calls this minute, or no tokens left
 * today, answers 429 in words a reader can act on. A preHandler, so it runs after
 * the auth guard has verified the token and set `req.user`, and before the route
 * reads its body or hijacks the stream.
 *
 * Not the rate-limit plugin's route option: that runs one limiter per request,
 * and the global one has already run by then (see auth.ts, `loginLimit`).
 */
export function aiGuard(kind: AiKind) {
  return async function guard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
    const caller = callerOf(req);
    const wait = perMinute[kind].take(`${kind}|${caller}`);
    if (wait !== null) {
      const { max, unit } = WHAT[kind];
      return reply
        .code(429)
        .header('retry-after', String(wait))
        .send({
          error: 'rate_limited',
          message: `You are asking too quickly: the limit is ${max} ${unit} a minute for each person. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
        });
    }
    // Only the hosted API is billed.
    if (config.ai.provider !== 'anthropic') return;
    const refusal = aiBudget.refusal(caller);
    if (refusal) {
      return reply.code(429).header('retry-after', String(refusal.retryAfter)).send({ error: 'ai_budget', message: refusal.message });
    }
  };
}

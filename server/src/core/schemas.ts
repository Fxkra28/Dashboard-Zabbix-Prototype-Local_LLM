import type { FastifyServerOptions } from 'fastify';

/**
 * Request body schemas for every POST route, in plain JSON Schema, checked by Fastify's own
 * validation before the handler runs. A malformed body is a 400 `bad_request` in the usual `{
 * error, message }` shape (`validationProblem`, called from errors.ts), whatever route it was sent
 * to.
 *
 * The schemas fix the shape of a body; the finer rules stay in the handlers: digits only in an
 * event id, the message cut at 2,048 characters, a chat that must end on a user turn.
 *
 * GET routes declare their query names with `singleValues` (below): one value each, as text, and
 * nothing more, so every query string a client sends today is read as before.
 */

/**
 * Fastify's validator coerces types unless told not to: the text "false" becomes
 * false, the number 5 becomes "5", a list of one name becomes the name. The
 * handlers refuse those, so pass this to `Fastify({ ajv })` or the schemas would
 * quietly accept what the handlers reject. index.ts and the test helpers both do.
 */
export const AJV_OPTIONS: NonNullable<FastifyServerOptions['ajv']> = {
  // Union types such as ['string', 'array'] are plain JSON Schema; Ajv logs a warning at startup without this.
  customOptions: { coerceTypes: false, allowUnionTypes: true },
};

/** The longest query value a route reads is a list of 50 item ids. */
export const QUERY_VALUE_MAX = 2_000;

/**
 * A query string of single values. Fastify hands a handler a name sent twice as a list, which no
 * handler reads: `search.trim()` on one was a 500. Names not listed pass as before.
 */
export function singleValues(...names: string[]) {
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, { type: 'string', maxLength: QUERY_VALUE_MAX }])),
  } as const;
}

/** Sign-in. An empty string is a valid body: it fails as a wrong password, with a 401, as before. */
export const loginBody = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
} as const;

/**
 * Emailing the SLA report: the month, the formats, who it goes to, whether to keep that list, and the style. The handler
 * refuses anything else, in the body and in the style. No `additionalProperties: false`: Fastify's validator would strip
 * a stray field and the request would go through.
 */
export const emailReportBody = {
  type: 'object',
  required: ['month', 'formats'],
  properties: {
    month: { type: 'string', maxLength: 16 },
    formats: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 8 } },
    to: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 320 } },
    remember: { type: 'boolean' },
    style: {
      type: 'object',
      properties: {
        decimal: { type: 'string', maxLength: 16 },
        date: { type: 'string', maxLength: 16 },
        separator: { type: 'string', maxLength: 16 },
      },
    },
  },
} as const;

/**
 * The monthly schedule: every field but the style is required. The handler checks the values and refuses any field not named
 * here, in the body and in the style, for the reason the email body gives.
 */
export const scheduleBody = {
  type: 'object',
  required: ['enabled', 'day', 'time', 'formats', 'recipients', 'notify'],
  properties: {
    enabled: { type: 'boolean' },
    day: { type: 'integer' },
    time: { type: 'string', maxLength: 8 },
    formats: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 8 } },
    recipients: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 320 } },
    notify: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 320 } },
    style: {
      type: 'object',
      properties: {
        decimal: { type: 'string', maxLength: 16 },
        date: { type: 'string', maxLength: 16 },
        separator: { type: 'string', maxLength: 16 },
      },
    },
  },
} as const;

/** The saved list of recipients, replaced as a whole. The handler checks the addresses and refuses any other field. */
export const recipientsBody = {
  type: 'object',
  required: ['recipients'],
  properties: {
    recipients: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 320 } },
  },
} as const;

/** Sign-out and renewal read no body: none at all, or a JSON object that is ignored. */
export const noBody = { type: ['object', 'null'] } as const;

/** Acknowledge. null is "not given", as the handler has always read it. */
export const acknowledgeBody = {
  type: 'object',
  required: ['eventids'],
  properties: {
    // One id or a list; the handler checks the digits and drops members that are not text.
    eventids: { type: ['string', 'array'] },
    message: { type: ['string', 'null'] },
    close: { type: ['boolean', 'null'] },
    acknowledge: { type: ['boolean', 'null'] },
  },
} as const;

/** The assistant. Blank turns, long turns and a last turn that is not the user's are the handler's to judge. */
export const chatBody = {
  type: 'object',
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    },
  },
} as const;

interface Problem {
  keyword?: string;
  instancePath?: string;
  params?: Record<string, unknown>;
}

const SUBJECT: Record<string, string> = {
  body: 'The request body',
  querystring: 'The query string',
  params: 'The path',
  headers: 'The headers',
};

const TYPE_WORD: Record<string, string> = {
  string: 'text',
  boolean: 'true or false',
  array: 'a list',
  object: 'a JSON object',
  integer: 'a whole number',
  number: 'a number',
};

/** `/messages/0/role` as `messages[0].role`. */
function fieldName(pointer: string): string {
  return pointer
    .split('/')
    .filter(Boolean)
    .map((part, i) => (/^\d+$/.test(part) ? `[${part}]` : i ? `.${part}` : part))
    .join('');
}

/**
 * One plain sentence for a Fastify validation error, or null when `err` is not
 * one. Names the field and the rule, never the value sent: what a caller typed
 * is not echoed back.
 */
export function validationProblem(err: unknown): string | null {
  const e = err as { validation?: unknown; validationContext?: unknown } | null;
  if (!e || !Array.isArray(e.validation) || !e.validation.length) return null;

  const problem = e.validation[0] as Problem;
  const params = problem.params ?? {};
  const subject = SUBJECT[String(e.validationContext)] ?? 'The request';
  const name = fieldName(problem.instancePath ?? '');
  const limit = Number(params.limit);

  switch (problem.keyword) {
    case 'required':
      return `${[name, String(params.missingProperty)].filter(Boolean).join('.')} is required.`;
    case 'type': {
      // A query value is text or, for a name sent twice, a list of texts.
      if (e.validationContext === 'querystring' && params.type === 'string') return `${name} must be given once.`;
      // Ajv joins a list of types with commas. null means "may be left out", so it is not worth naming.
      const types = String(params.type).split(',');
      const named = types.length > 1 ? types.filter((t) => t !== 'null') : types;
      return `${name || subject} must be ${named.map((t) => TYPE_WORD[t] ?? t).join(' or ')}.`;
    }
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues : [];
      return `${name || subject} must be one of: ${allowed.join(', ')}.`;
    }
    case 'minItems':
    case 'minLength':
      return limit <= 1 ? `${name || subject} must not be empty.` : `${name || subject} must have at least ${limit} ${problem.keyword === 'minItems' ? 'items' : 'characters'}.`;
    case 'maxItems':
    case 'maxLength':
      return `${name || subject} must have at most ${limit} ${problem.keyword === 'maxItems' ? 'items' : 'characters'}.`;
    default:
      return `${name || subject} is not valid.`;
  }
}

/**
 * A hand-written check that an answer from the BFF has the shape a page relies on. The
 * shapes stay in types/, the one source: each shape below is typed `Shape<T>`, which makes the
 * compiler ask for every field of T, so a field added to or dropped from a type is a build error
 * here and not a blank page in the browser.
 *
 * What is checked is the type's own claim: a required field is there and has the right kind, an
 * optional one has the right kind when it is there, and an object may carry more than it names. The
 * values behind a union such as `HostState` are not checked, only that they are text, so a state
 * a newer BFF adds reads as no state instead of failing the page.
 */

/** Where an answer goes wrong, and how: `path` is empty at the value itself. */
interface Misfit {
  path: string;
  why: string;
}

export type Check = (value: unknown) => Misfit | null;

export type Shape<T> = { [K in keyof T]-?: Check };

export const bad = (value: unknown, kind: string): Misfit => ({ path: '', why: value === undefined ? 'is missing' : `is not ${kind}` });

const join = (head: string, rest: string) => (rest === '' ? head : head === '' ? rest : rest.startsWith('[') ? head + rest : `${head}.${rest}`);

export const under = (head: string, m: Misfit): Misfit => ({ path: join(head, m.path), why: m.why });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const text: Check = (v) => (typeof v === 'string' ? null : bad(v, 'text'));

export const num: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : bad(v, 'a number'));

export const flag: Check = (v) => (typeof v === 'boolean' ? null : bad(v, 'true or false'));

/** A key that may be left out (JSON has no undefined, so left out is all it can be). */
export const opt =
  (check: Check): Check =>
  (v) =>
    v === undefined ? null : check(v);

export const orNull =
  (check: Check): Check =>
  (v) =>
    v === null ? null : check(v);

export const listOf =
  (item: Check): Check =>
  (v) => {
    if (!Array.isArray(v)) return bad(v, 'a list');
    for (let i = 0; i < v.length; i++) {
      const m = item(v[i]);
      if (m) return under(`[${i}]`, m);
    }
    return null;
  };

/** An object whose every value passes `value`, under keys of any name ("severity" -> count). */
export const recordOf =
  (value: Check): Check =>
  (v) => {
    if (!isObject(v)) return bad(v, 'an object');
    for (const [k, inner] of Object.entries(v)) {
      const m = value(inner);
      if (m) return under(k, m);
    }
    return null;
  };

export const shape =
  <T>(fields: Shape<T>): Check =>
  (v) => {
    if (!isObject(v)) return bad(v, 'an object');
    for (const [key, check] of Object.entries<Check>(fields)) {
      const m = check(v[key]);
      if (m) return under(key, m);
    }
    return null;
  };

/** A checked kind of answer: what it is called to a person, and how to tell whether a value is one. */
export interface Guard<T> {
  /** For a sentence a person reads: "the problem list". */
  what: string;
  /** Null when `value` fits; otherwise the first thing wrong, for a log (never shown to a person). `T` is for the compiler only. */
  misfit: (value: unknown) => string | null;
  readonly _type?: T;
}

export function guard<T>(what: string, check: Check): Guard<T> {
  return {
    what,
    misfit: (value) => {
      const m = check(value);
      return m ? `${m.path || 'the answer'} ${m.why}` : null;
    },
  };
}

export const tag = shape<{ tag: string; value: string }>({ tag: text, value: text });

export const counts = recordOf(num);

/** A service tree is as deep as the estate's groups, so a node names its children through this. */
export const lazy =
  (get: () => Check): Check =>
  (v) =>
    get()(v);

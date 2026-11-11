import { parseYaml } from '@redocly/openapi-core';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';
import specSource from '../../../docs/api/openapi.yaml?raw';
import generatedSource from '../generated/openapi?raw';
import generatedJson from '../generated/openapi.json?raw';
import type { paths } from '../generated/openapi';
import type * as Web from '../types';

/**
 * FR-16, the generated half. The web app reads the server's answers as hand-written types (types/), and
 * docs/api/openapi.yaml describes the same answers. src/generated/openapi.ts is made from that file, so it
 * is what the file says. This test holds the two apart where they could drift:
 *
 *   1. at compile time, every answer the app reads as data is checked against the file: what the file says
 *      the answer can be has to be something the app's type accepts (`npm run typecheck` fails otherwise);
 *   2. at run time, every such call in api/ has an entry below, and the generated file is current.
 *
 * The comparison is one way on purpose. A field the file lists and the app ignores is fine, and so is an
 * enum the file narrows where the app says "string". What fails is a field the app needs and the file does
 * not promise (absent, or optional), and a kind the app cannot hold. The file's `additionalProperties`
 * does not count as a promise of any field.
 */

/** A value that only carries its type, so the table below is both a list at run time and a map of types. */
const typed = <T>() => undefined as unknown as T;

/** Each GET path api/ reads with `request<T>`, and the type it reads the answer as. */
const READS = {
  '/api/health': typed<Web.Health>(),
  '/api/hosts': typed<Web.Host[]>(),
  '/api/hosts/overview': typed<Web.HostOverview[]>(),
  '/api/devices': typed<Web.DevicesResponse>(),
  '/api/hostgroups': typed<Web.HostGroup[]>(),
  '/api/items': typed<Web.Item[]>(),
  '/api/latest': typed<Web.LatestResponse>(),
  '/api/graph': typed<Web.GraphResponse>(),
  '/api/net/interfaces': typed<Web.NetInterfacesResponse>(),
  '/api/problems': typed<Web.Problem[]>(),
  '/api/net/devices': typed<Web.NetDevice[]>(),
  '/api/net/meters': typed<Web.MetersResponse>(),
  '/api/reports/top-hosts': typed<Web.TopHostsResponse>(),
  '/api/reports/web-monitoring': typed<Web.WebMonitoringResponse>(),
  '/api/reports/top-triggers': typed<Web.TopTriggersReport>(),
  '/api/stats': typed<Web.Stats>(),
  '/api/freshness': typed<Web.Freshness>(),
  '/api/reports/problems-by-group': typed<Web.GroupProblems[]>(),
  '/api/maps': typed<Web.ZMap[]>(),
  '/api/maps/detail': typed<Web.MapDetail[]>(),
  '/api/auth/me': typed<Web.Me>(),
  '/api/sites': typed<Web.SitesResponse>(),
  '/api/reports/inventory': typed<Web.ScorecardResponse>(),
  '/api/links': typed<Web.LinksResponse>(),
  '/api/reports/availability': typed<Web.AvailabilityReport>(),
  '/api/reports/aging': typed<Web.AgingReport>(),
  '/api/reports/capacity': typed<Web.CapacityReport>(),
  '/api/reports/noise': typed<Web.NoiseReport>(),
  '/api/services': typed<Web.ServicesResponse>(),
  '/api/services/derived': typed<Web.DerivedServicesResponse>(),
  '/api/sli': typed<Web.SliReport>(),
  '/api/sli/email': typed<Web.EmailInfo>(),
  '/api/sli/schedule': typed<Web.ScheduleInfo>(),
  '/api/sla/source': typed<Web.SlaSource>(),
  '/api/sla': typed<Web.Sla[]>(),
  '/api/sla/sli': typed<Web.SlaSli[]>(),
  '/api/explain/problem': typed<Web.ProblemExplanation>(),
  '/api/explain/sla': typed<Web.SlaExplanation>(),
};

/** Each POST path api/ reads with `post<T>`. */
const WRITES = {
  '/api/problems/acknowledge': typed<Web.AcknowledgeResult>(),
  '/api/sli/email': typed<Web.EmailSent>(),
};

/** Each PUT path api/ reads with `put<T>`. */
const PUTS = {
  '/api/sli/recipients': typed<Web.SavedRecipients>(),
  '/api/sli/schedule': typed<Web.ScheduleInfo>(),
};

/** Each DELETE path api/ reads with `del<T>`. */
const DELETES = {
  '/api/sli/recipients': typed<Web.DeletedRecipients>(),
};

// The comparison

/** The keys a type names, without the ones an index signature (`additionalProperties`) stands for. */
type Listed<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
type Prefix<P extends string, T> = T extends string ? `${P}${T}` : never;
type Present<T> = NonNullable<T>;

/**
 * Where `S` (what the file says) is not accepted by `W` (what the app reads it as), as paths into the answer:
 * `.devices[].status` is the status of each device, `.concentration.topN(missing)` is a field the app needs
 * and the file does not list. Nothing (`never`) when `S` fits `W`. A path that stops at `...` went deeper than
 * the comparison looks, for a type that contains itself.
 */
type Drift<S, W, D extends unknown[] = []> = [S] extends [W]
  ? never
  : D['length'] extends 8
    ? '...'
    : [Present<S>] extends [readonly (infer SE)[]]
      ? [Present<W>] extends [readonly (infer WE)[]]
        ? Prefix<'[]', Drift<SE, WE, [...D, 0]>>
        : ''
      : [Present<S>] extends [object]
        ? [Present<W>] extends [object]
          ? {
              [K in keyof Present<W>]-?: K extends Listed<Present<S>>
                ? Prefix<`.${K & string}`, Drift<Present<S>[K], Present<W>[K], [...D, 0]>>
                : undefined extends Present<W>[K]
                  ? never
                  : `.${K & string}(missing)`;
            }[keyof Present<W>]
          : ''
        : '';

/** The 200 body, as JSON, that the file documents for a method on a path. */
type Body<P extends string, M extends 'get' | 'post' | 'put' | 'delete'> = P extends keyof paths
  ? paths[P] extends { [K in M]: { responses: { 200: { content: { 'application/json': infer B } } } } }
    ? B
    : 'no JSON body for the 200 answer'
  : 'no such path';

type Drifts<M extends 'get' | 'post' | 'put' | 'delete', R extends Record<string, unknown>> = {
  [P in keyof R & string]: Prefix<P, Drift<Body<P, M>, R[P]>>;
}[keyof R & string];

/**
 * Every place an answer drifts, named by path. `{}` fits only when there are none: if this line fails to
 * compile, the error lists the first of them. Hover `Drifts` for the whole list.
 */
export const noDrift: Record<Drifts<'get', typeof READS> | Drifts<'post', typeof WRITES> | Drifts<'put', typeof PUTS> | Drifts<'delete', typeof DELETES>, never> = {};

// The comparison has to be able to fail. Each `@ts-expect-error` below becomes an error of its own, as an unused
// directive, if the comparison ever stops reporting what it should; the last three show what it lets through.
type Fails<S, W> = Record<Drift<S, W> & string, never>;
export const proofs: {
  missingField: Fails<{ a: string }, { a: string; b: number }>;
  optionalWhereNeeded: Fails<{ a?: string }, { a: string }>;
  otherKind: Fails<{ a: string }, { a: number }>;
  insideAList: Fails<{ rows: { a: string }[] }, { rows: { a: number }[] }>;
  hiddenByAdditionalProperties: Fails<{ a: string } & { [key: string]: unknown }, { a: string; b: string }>;
  nullWhereNotAllowed: Fails<{ a: string | null }, { a: string }>;
  noSuchPath: Record<Drift<Body<'/api/nothing', 'get'>, { a: string }>, never>;
  narrowerEnum: Fails<{ a: 'x' | 'y' }, { a: string }>;
  extraFieldInTheFile: Fails<{ a: string; b: number }, { a: string }>;
  optionalFieldNotListed: Fails<{ a: string }, { a: string; b?: number }>;
} = {
  // @ts-expect-error a field the app needs and the file never lists
  missingField: {},
  // @ts-expect-error a field the file says may be absent, where the app needs it
  optionalWhereNeeded: {},
  // @ts-expect-error a kind the app cannot hold
  otherKind: {},
  // @ts-expect-error the same, inside the items of a list
  insideAList: {},
  // @ts-expect-error a field the app needs, which additionalProperties does not promise
  hiddenByAdditionalProperties: {},
  // @ts-expect-error a value the file allows to be null, where the app does not
  nullWhereNotAllowed: {},
  // @ts-expect-error a path the file does not have
  noSuchPath: {},
  narrowerEnum: {},
  extraFieldInTheFile: {},
  optionalFieldNotListed: {},
};

// Run time

/** Every file of api/ as one text: the calls are in a file for each part of the portal. */
const apiSource = Object.values(import.meta.glob('../api/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).join('\n');

/** The paths a helper (`request`, `post` or `put`) is called with in api/, once each. */
const callsIn = (source: string, helper: 'request' | 'post' | 'put' | 'del') =>
  [...new Set([...source.matchAll(new RegExp(`\\b${helper}<[^(]*\\(\\s*[\`'](/api/[\\w/-]+)`, 'g'))].map((m) => m[1]))].sort();

describe('the OpenAPI file and the web types (FR-16)', () => {
  it('has an entry above for every answer api/ reads as data, and for nothing else', () => {
    expect(callsIn(apiSource, 'request').length, 'the pattern still finds the calls').toBeGreaterThan(30);
    expect(callsIn(apiSource, 'request')).toEqual(Object.keys(READS).sort());
    expect(callsIn(apiSource, 'post')).toEqual(Object.keys(WRITES).sort());
    expect(callsIn(apiSource, 'put')).toEqual(Object.keys(PUTS).sort());
    expect(callsIn(apiSource, 'del')).toEqual(Object.keys(DELETES).sort());
  });

  it('has a generated file that is current, made from the OpenAPI file as it is now', async () => {
    // What `openapi-typescript <file> -o <out>` writes: its header, then the types.
    const made = COMMENT_HEADER + astToString(await openapiTS(specSource, { silent: true }));
    expect(made === generatedSource, 'src/generated/openapi.ts is out of date: run `npm run gen:api` in web/ and commit the result').toBe(true);
  }, 30_000);

  it('has a JSON copy that is current, which the server holds every answer to (BK-14)', () => {
    // What scripts/openapi-json.mjs writes: the file without `servers`, parsed by openapi-typescript's own parser.
    const spec = parseYaml(specSource) as Record<string, unknown>;
    delete spec.servers;
    const made = `${JSON.stringify(spec, null, 2)}\n`;
    expect(made === generatedJson, 'src/generated/openapi.json is out of date: run `npm run gen:api` in web/').toBe(true);
  });
});

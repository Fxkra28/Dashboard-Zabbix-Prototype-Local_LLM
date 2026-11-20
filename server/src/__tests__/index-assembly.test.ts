import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * How index.ts puts the server together (IN-82). It starts a server on import, so no test can run it; each test used to copy the order by hand,
 * and only three orders were pinned. A moved line could make a route public, or leave one out, with every test green. This reads the file.
 */
const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const code = source
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

/** Where `needle` first appears in the code (comments left out), failing in words when it does not. */
function at(needle: string): number {
  const i = code.indexOf(needle);
  expect(i, `index.ts has "${needle}"`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('index.ts: the order of setting up', () => {
  // Each step needs the one before it: the id first so that every refusal carries it, the Host check and the headers before any route,
  // the rate limit before sign-in is tried, compression and the no-store header before the routes they apply to, and sign-in before every route.
  const ORDER = [
    'installCrashLog(app)',
    'setCacheLogger(app.log)',
    'assertConfig(',
    'assertUsers(',
    'await initPortalState(',
    'closeWith(app, reportSchedule)',
    'registerRequestId(app)',
    'registerHostCheck(app)',
    'app.register(helmet',
    'app.register(cors',
    'await registerRateLimit(app)',
    'registerCompression(app)',
    'registerNoStore(app)',
    'registerStaleHeaders(app)',
    'registerHealth(app)',
    'registerErrorHandler(app)',
    'await setupAuth(app, userDirectory())',
    'app.register(hostRoutes)',
    'app.listen(',
    'installShutdown(app)',
  ];

  it('is the order that each step needs, from the crash log to the shutdown handler', () => {
    const places = ORDER.map(at);
    expect(places, ORDER.join(' < ')).toEqual([...places].sort((a, b) => a - b));
  });

  it('starts the crash log before anything that can fail, awaited or not (BK-68)', () => {
    expect(at('installCrashLog(app)')).toBeLessThan(at('assertConfig('));
    expect(at('installCrashLog(app)')).toBeLessThan(code.indexOf('await '));
  });
});

describe('index.ts: the route modules', () => {
  const registered = [...code.matchAll(/app\.register\((\w+Routes)\b/g)].map((m) => m[1]);
  const exported = readdirSync(new URL('../routes', import.meta.url))
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(new URL(`../routes/${f}`, import.meta.url), 'utf8').matchAll(/export async function (\w+Routes)\b/g)].map((m) => m[1]));

  it('registers every route module there is, each once', () => {
    expect(exported.length).toBeGreaterThan(20);
    expect([...registered].sort()).toEqual([...exported].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('registers each of them after sign-in is set up, so that the guard covers it', () => {
    const guard = at('await setupAuth(app, userDirectory())');
    for (const name of registered) expect(code.indexOf(`app.register(${name}`), name).toBeGreaterThan(guard);
  });
});

describe('index.ts: the log file (IN-83)', () => {
  it('makes the stream from the log settings and hands it to Fastify’s logger', () => {
    expect(code).toMatch(/const logStream = createLogStream\(config\.log\);/);
    expect(code).toMatch(/logger: \{[^\n]*\.\.\.\(logStream \? \{ stream: logStream \} : \{\}\)/);
    expect(at('createLogStream(config.log)')).toBeLessThan(at('Fastify({'));
  });
});

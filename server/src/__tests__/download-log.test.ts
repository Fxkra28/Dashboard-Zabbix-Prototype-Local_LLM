import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Who took a report (SC-42): one line for each file, with the person, the address, which report, the
 * month, the format and the size, and nothing of what the file holds.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = 'ana:viewer-pass:viewer';
});
vi.mock('../services/sli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sli.js')>()),
  getMonthlySli: vi.fn(async () => ({})),
}));
vi.mock('../services/sliExport.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sliExport.js')>()),
  fileFor: vi.fn(() => Buffer.from('a report file of 24 bytes')),
}));

const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { sliExportRoutes } = await import('../routes/sliExport.js');

type Line = Record<string, unknown> & { msg: string };
let app: FastifyInstance;
let lines: Line[];

beforeEach(async () => {
  lines = [];
  app = Fastify({ logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } } });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(sliExportRoutes);
  await app.ready();
});
afterEach(() => app.close());

const download = (query: string) =>
  app.inject({
    url: `/api/sli/export?${query}`,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'ana', role: 'viewer', ...tokenClaims('hcml_session') }, { expiresIn: '1h' })}` },
    remoteAddress: '10.9.8.7',
  });
const downloads = () => lines.filter((l) => l.event === 'report_download');

describe('one line for each report downloaded', () => {
  it('says who took which report, in which format, and how large', async () => {
    const res = await download('month=2026-09&format=xlsx');
    expect(res.statusCode).toBe(200);
    expect(downloads()).toHaveLength(1);
    expect(downloads()[0]).toMatchObject({
      event: 'report_download',
      user: 'ana',
      ip: '10.9.8.7',
      report: 'sla',
      month: '2026-09',
      format: 'xlsx',
      bytes: 'a report file of 24 bytes'.length,
      msg: 'report download',
    });
  });

  it('writes nothing for a request that was refused', async () => {
    expect((await download('month=2026-09&format=exe')).statusCode).toBe(400);
    expect((await download('month=nope&format=pdf')).statusCode).toBe(400);
    expect(downloads()).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Who acknowledged what. Zabbix files every write under the write token's owner, so the
 * portal user goes into the message, every attempt and failure is logged with user and address, and one
 * request acts on at most 50 events.
 */
vi.hoisted(() => {
  process.env.AUTH_ENABLED = 'true';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-bytes-long';
  process.env.PORTAL_USERS = `olu:operator-pass:operator,adi:admin-pass:admin,ana:viewer-pass:viewer,x[y]z:bracket-pass:operator,${'u'.repeat(64)}:long-pass:operator`;
});

const { zbxWriteMock } = vi.hoisted(() => ({ zbxWriteMock: vi.fn() }));
vi.mock('../clients/zabbix.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clients/zabbix.js')>()),
  zbxWrite: zbxWriteMock,
}));

const { config } = await import('../core/config.js');
const { setupAuth, tokenClaims } = await import('../security/auth.js');
const { registerErrorHandler } = await import('../http/errors.js');
const { actionRoutes } = await import('../routes/actions.js');
const { MAX_EVENTIDS } = await import('../services/actions.js');
const { ZabbixApiError, ZabbixRefusedError, ZabbixTimeoutError, ZabbixAuthError } = await import('../clients/zabbix.js');
const { AJV_OPTIONS } = await import('../core/schemas.js');

type Line = Record<string, unknown> & { level: number; msg: string };

let app: FastifyInstance;
let lines: Line[];
const savedToken = config.zbxWriteToken;

beforeEach(async () => {
  zbxWriteMock.mockReset().mockResolvedValue({ eventids: ['109'] });
  config.zbxWriteToken = 'test-only-not-a-real-token';
  lines = [];
  app = Fastify({
    logger: { level: 'info', stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as Line) } },
    ajv: AJV_OPTIONS, // as index.ts builds it
  });
  registerErrorHandler(app);
  await setupAuth(app);
  await app.register(actionRoutes);
  await app.ready();
});
afterEach(async () => {
  config.zbxWriteToken = savedToken;
  config.auth.enabled = true;
  await app.close();
});

const token = (sub: string, role: string) => app.jwt.sign({ sub, role, ...tokenClaims(config.auth.sessionCookie) }, { expiresIn: '1h' });
const ack = (payload: unknown, who: [string, string] = ['olu', 'operator'], remoteAddress = '10.9.8.7') =>
  app.inject({
    method: 'POST',
    url: '/api/problems/acknowledge',
    headers: { authorization: `Bearer ${token(...who)}` },
    remoteAddress,
    payload: payload as object,
  });
const sentToZabbix = () => zbxWriteMock.mock.calls.at(-1)?.[1] as { eventids: string[]; action: number; message: string };
const logged = (msg: string) => lines.filter((l) => l.msg === msg);

describe('the message Zabbix records', () => {
  it('always starts with [portal:<user>], also when the user wrote nothing', async () => {
    const res = await ack({ eventids: ['109'] });
    expect(res.statusCode).toBe(200);
    expect(sentToZabbix()).toEqual({ eventids: ['109'], action: 6, message: '[portal:olu]' });
  });

  it('puts the user\'s own text after the tag', async () => {
    await ack({ eventids: ['109'], message: '  checking the link  ' });
    expect(sentToZabbix().message).toBe('[portal:olu] checking the link');
  });

  it('tags a close the same way, and a user is named by the sign-in, not by anything in the request', async () => {
    await ack({ eventids: ['109'], acknowledge: false, close: true }, ['adi', 'admin']);
    expect(sentToZabbix()).toMatchObject({ action: 5, message: '[portal:adi]' });
  });

  it('keeps the real tag first when the text imitates another user', async () => {
    await ack({ eventids: ['109'], message: '[portal:adi] approved by the admin' });
    expect(sentToZabbix().message).toBe('[portal:olu] [portal:adi] approved by the admin');
  });

  it('drops brackets from a user name, so the tag cannot be closed early', async () => {
    await ack({ eventids: ['109'] }, ['x[y]z', 'operator']);
    expect(sentToZabbix().message).toBe('[portal:xyz]');
  });

  it('cuts a long text at 2048 characters and keeps the tag', async () => {
    await ack({ eventids: ['109'], message: 'x'.repeat(5000) });
    const { message } = sentToZabbix();
    expect(message).toHaveLength(2048);
    expect(message.startsWith('[portal:olu] xxx')).toBe(true);
  });

  it('never cuts a character in two where the limit falls inside it (reviewer, 11 November)', async () => {
    const face = String.fromCodePoint(0x1f600);
    // The tag and its space are 13 characters, so the 2048th is the first half of the first face.
    const res = await ack({ eventids: ['109'], message: `${'x'.repeat(2034)}${face}${face}` });
    expect(res.statusCode, res.body).toBe(200);
    const { message } = sentToZabbix();
    expect(message).not.toMatch(/[\ud800-\udbff]$/);
    expect(message.startsWith('[portal:olu] xxx')).toBe(true);
  });

  it('keeps every character of the longest note the dialog allows, behind the longest name', async () => {
    const res = await ack({ eventids: ['109'], message: `${'n'.repeat(1971)}END` }, ['u'.repeat(64), 'operator']);
    expect(res.statusCode, res.body).toBe(200);
    const { message } = sentToZabbix();
    expect(message).toHaveLength(2048);
    expect(message.endsWith('nnnEND')).toBe(true);
  });

  it('says anonymous with sign-in off, where nobody is named', async () => {
    // Auth is read when the guard is mounted, so this server is built with it off.
    config.auth.enabled = false;
    config.auth.allowWriteWithoutAuth = true;
    const open = Fastify({ logger: false, ajv: AJV_OPTIONS });
    try {
      registerErrorHandler(open);
      await setupAuth(open);
      await open.register(actionRoutes);
      const res = await open.inject({ method: 'POST', url: '/api/problems/acknowledge', payload: { eventids: ['109'] } });
      expect(res.statusCode).toBe(200);
      expect(sentToZabbix().message).toBe('[portal:anonymous]');
    } finally {
      config.auth.allowWriteWithoutAuth = false;
      await open.close();
    }
  });

  it('still answers with the action the caller asked for, as before the tag existed', async () => {
    expect((await ack({ eventids: ['109'] })).json()).toEqual({ ok: true, eventids: ['109'], action: 2 });
    expect((await ack({ eventids: ['109'], acknowledge: false, close: true })).json().action).toBe(1);
    expect((await ack({ eventids: ['109'], message: 'note' })).json().action).toBe(6);
  });

  it('is still a 400, with nothing sent, when the caller asked for nothing: the tag alone is not a request', async () => {
    const res = await ack({ eventids: ['109'], acknowledge: false, close: false, message: '   ' });
    expect(res.statusCode).toBe(400);
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });
});

describe('the cap on event ids', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String(1000 + i));

  it('takes 50 in one request', async () => {
    expect(MAX_EVENTIDS).toBe(50);
    const res = await ack({ eventids: ids(50) });
    expect(res.statusCode).toBe(200);
    expect(sentToZabbix().eventids).toHaveLength(50);
  });

  it('answers 400 to 51, and writes nothing', async () => {
    const res = await ack({ eventids: ids(51) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_request', message: 'At most 50 event ids per request.' });
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('answers 400 to a request for a whole estate, and logs no more than 50 of the ids', async () => {
    const res = await ack({ eventids: ids(5000) });
    expect(res.statusCode).toBe(400);
    expect((logged('zabbix write-back refused')[0].eventids as string[]).length).toBe(50);
  });
});

describe('the log', () => {
  it('records an attempt and its outcome with the user, the address, the event ids and the action', async () => {
    await ack({ eventids: ['109', '110'], close: true, message: 'private words' });
    expect(logged('zabbix write-back attempt')).toEqual([
      expect.objectContaining({ level: 30, user: 'olu', ip: '10.9.8.7', eventids: ['109', '110'] }),
    ]);
    expect(logged('zabbix write-back')).toEqual([
      expect.objectContaining({ level: 30, user: 'olu', ip: '10.9.8.7', eventids: ['109', '110'], action: 7, close: true, acknowledge: true }),
    ]);
    // The attempt comes first, so a call that never returns is still on record.
    expect(lines.findIndex((l) => l.msg === 'zabbix write-back attempt')).toBeLessThan(lines.findIndex((l) => l.msg === 'zabbix write-back'));
  });

  it('keeps the text of the message out of the log', async () => {
    await ack({ eventids: ['109'], message: 'private words' });
    expect(JSON.stringify(lines)).not.toContain('private words');
  });

  it('records a failure at Zabbix with the same fields and what went wrong', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixApiError('Zabbix said no: manual close is not allowed', 'detail'));
    const res = await ack({ eventids: ['109'], acknowledge: false, close: true }, ['adi', 'admin'], '10.1.2.3');
    expect(res.statusCode).toBe(502);
    expect(logged('zabbix write-back failed')).toEqual([
      expect.objectContaining({
        level: 40,
        user: 'adi',
        ip: '10.1.2.3',
        eventids: ['109'],
        action: 5,
        close: true,
        acknowledge: false,
        err: expect.stringContaining('manual close is not allowed'),
      }),
    ]);
    expect(logged('zabbix write-back')).toHaveLength(0);
  });

  it('records a refusal with the user and address, so a probe or a slip is on record', async () => {
    await ack({ eventids: ['abc'] }, ['olu', 'operator'], '10.5.5.5');
    expect(logged('zabbix write-back refused')).toEqual([
      expect.objectContaining({ level: 40, user: 'olu', ip: '10.5.5.5', eventids: ['abc'], status: 400, error: 'bad_request' }),
    ]);
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('records a refusal because write-back is off too', async () => {
    config.zbxWriteToken = '';
    const res = await ack({ eventids: ['109'] });
    expect(res.statusCode).toBe(503);
    expect(logged('zabbix write-back refused')).toEqual([expect.objectContaining({ user: 'olu', status: 503, error: 'zabbix_write_disabled' })]);
  });

  it('records the attempt even when the body is turned away before the handler', async () => {
    const res = await ack({ eventids: ['109'], message: 5 });
    expect(res.statusCode).toBe(400);
    expect(logged('zabbix write-back attempt')).toEqual([expect.objectContaining({ user: 'olu', ip: '10.9.8.7', eventids: ['109'] })]);
    expect(logged('zabbix write-back refused')).toEqual([expect.objectContaining({ user: 'olu', ip: '10.9.8.7', eventids: ['109'], status: 400 })]);
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('says in the attempt what it was for: acknowledge and close, as asked, whatever else the body holds', async () => {
    await ack({ eventids: ['109'], acknowledge: false, close: true });
    await ack({ eventids: ['110'] });
    await ack({ eventids: ['111'], acknowledge: 'no', close: 'yes' });
    expect(logged('zabbix write-back attempt').map((l) => [l.acknowledge, l.close])).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
  });

  it('records a caller the guard turned away: a viewer with their name, a stranger as anonymous, neither reaching Zabbix', async () => {
    const viewer = await ack({ eventids: ['109'] }, ['ana', 'viewer'], '10.4.4.4');
    expect(viewer.statusCode).toBe(403);
    const stranger = await app.inject({ method: 'POST', url: '/api/problems/acknowledge', remoteAddress: '10.6.6.6', payload: { eventids: ['109'] } });
    expect(stranger.statusCode).toBe(401);
    expect(logged('zabbix write-back refused')).toEqual([
      expect.objectContaining({ level: 40, user: 'ana', ip: '10.4.4.4', status: 403, eventids: [] }),
      expect.objectContaining({ level: 40, user: 'anonymous', ip: '10.6.6.6', status: 401, eventids: [] }),
    ]);
    expect(zbxWriteMock).not.toHaveBeenCalled();
  });

  it('logs a refusal once, and a failure at Zabbix once, not again as the response goes out', async () => {
    await ack({ eventids: ['abc'] });
    expect(logged('zabbix write-back refused')).toHaveLength(1);

    lines.length = 0;
    zbxWriteMock.mockRejectedValue(new ZabbixApiError('Zabbix said no', 'detail'));
    expect((await ack({ eventids: ['109'] })).statusCode).toBe(502);
    expect(logged('zabbix write-back failed')).toHaveLength(1);
    expect(logged('zabbix write-back refused')).toHaveLength(0);
  });

  it('logs nothing as refused for a request that went through', async () => {
    expect((await ack({ eventids: ['109'] })).statusCode).toBe(200);
    expect(logged('zabbix write-back refused')).toHaveLength(0);
    expect(logged('zabbix write-back failed')).toHaveLength(0);
  });

  it('survives a body that is not an object, logging no ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/problems/acknowledge',
      headers: { authorization: `Bearer ${token('olu', 'operator')}`, 'content-type': 'application/json' },
      payload: '[1,2,3]',
    });
    expect(res.statusCode).toBe(400);
    expect(logged('zabbix write-back attempt')).toEqual([expect.objectContaining({ user: 'olu', eventids: [] })]);
  });
});

describe('what a person is told when Zabbix does not take the change (BK-43)', () => {
  const REFUSED = 'Zabbix refused the change. It may already be closed, or this account may not be allowed to change it.';
  const MAYBE = 'Zabbix did not answer in time, so the change may or may not have been made. Look at the problem again before you try it again.';
  const reference = (res: { json(): { message: string } }) => /quote reference (\S+)\.$/.exec(res.json().message)?.[1];

  it('says Zabbix refused the change, with the likely reasons and a reference, when Zabbix answered with an error', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixRefusedError('event.acknowledge: {"code":-32500,"data":"Cannot close problem: no manual close."}', 'ZBX_URL=http://zabbix.internal'));
    const res = await ack({ eventids: ['109'], acknowledge: false, close: true });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('zabbix_error');
    expect(res.json().message).toBe(`${REFUSED} Tell an administrator and quote reference ${reference(res)}.`);
    expect(reference(res)).toBeTruthy();
  });

  it('keeps Zabbix’s own words, the method and the address out of the answer, and puts them in the log', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixRefusedError('event.acknowledge: {"code":-32500,"data":"Cannot close problem: no manual close."}', 'ZBX_URL=http://zabbix.internal'));
    const res = await ack({ eventids: ['109'] });
    expect(res.body).not.toMatch(/event\.acknowledge|-32500|manual close|zabbix\.internal/);
    expect(JSON.stringify(lines)).toContain('Cannot close problem');
    expect(lines.filter((l) => l.level === 50)).toEqual([expect.objectContaining({ detail: 'ZBX_URL=http://zabbix.internal', msg: expect.stringContaining('Cannot close problem') })]);
    expect(logged('zabbix write-back failed')).toHaveLength(1);
    expect(logged('zabbix write-back refused')).toHaveLength(0);
  });

  it('says the change may or may not have been made when Zabbix did not answer in time', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixTimeoutError('Zabbix did not respond to event.acknowledge within 20000 ms.', 'ZBX_URL=http://zabbix.internal'));
    const res = await ack({ eventids: ['109'] });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('zabbix_timeout');
    expect(res.json().message).toBe(`${MAYBE} Tell an administrator and quote reference ${reference(res)}.`);
    expect(res.body).not.toMatch(/event\.acknowledge|20000|zabbix\.internal/);
    expect(logged('zabbix write-back failed')).toHaveLength(1);
  });

  it('still says the data source is not answering when Zabbix could not be reached at all', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixApiError('Could not reach Zabbix for event.acknowledge (ECONNREFUSED).', 'ZBX_URL=http://zabbix.internal'));
    const res = await ack({ eventids: ['109'] });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/^The data source is not answering\. Tell an administrator and quote reference \S+\.$/);
  });

  it('leaves a rejected write token as it was', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixAuthError('Zabbix rejected the API token.'));
    const res = await ack({ eventids: ['109'] });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('zabbix_auth');
  });

  it('names the same reference in the answer and in the log', async () => {
    zbxWriteMock.mockRejectedValue(new ZabbixRefusedError('event.acknowledge: {"code":-32500}'));
    const res = await ack({ eventids: ['109'] });
    const id = reference(res)!;
    expect(lines.some((l) => l.reqId === id)).toBe(true);
  });

  it('writes both sentences with no dash standing for punctuation', () => {
    for (const s of [REFUSED, MAYBE]) expect(s).not.toMatch(new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`));
  });
});


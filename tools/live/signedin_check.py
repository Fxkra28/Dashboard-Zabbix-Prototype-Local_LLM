"""Signed-in checks of a running portal through nginx (tracker.md SC-21, IN-01).

    PORTAL_USER=... PORTAL_PASSWORD=... python3 -I signedin_check.py http://localhost:8081 [--stream-seconds 80]
        [--expect-mail on|off|any] [--only-mail] [--month YYYY-MM]

The account must be an administrator: email and the monthly schedule are for administrators. `--expect-mail on` is for a copy that
has its MAIL_ settings (the hosted one), `off` for one that holds them back (the local-model copy), `any` takes either.
`--only-mail` runs the sign-in and the email, schedule and CSV checks alone, which is quick when they are the question.
The report downloads use the month that has just closed in Asia/Jakarta, since Zabbix keeps about a year of events and a fixed month would stop working; `--month` names another.

Read-only: only GETs after the sign-in. The cookie and the password are never printed or written.
Downloaded reports are checked in memory and dropped; their contents are not printed.
The stream step is sse_hold.py, which also runs alone against any stream.
"""
import http.cookiejar
import importlib.util
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone


def option(name, default):
    """The value after `name`, or `default` when the option is not given. An option with no value is a mistake, said in words."""
    if name not in sys.argv:
        return default
    at = sys.argv.index(name) + 1
    if at >= len(sys.argv) or sys.argv[at].startswith('--'):
        sys.exit(f'{name} needs a value')
    return sys.argv[at]


def month_just_closed():
    """YYYY-MM of the month before this one in Asia/Jakarta (UTC+7, no daylight saving)."""
    now = datetime.now(timezone(timedelta(hours=7)))
    year, mon = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    return f'{year}-{mon:02d}'


base = sys.argv[1].rstrip('/')
secs = int(option('--stream-seconds', '80'))
expect_mail = option('--expect-mail', 'any')
if expect_mail not in ('on', 'off', 'any'):
    sys.exit('--expect-mail is on, off or any')
only_mail = '--only-mail' in sys.argv
month = option('--month', month_just_closed())  # a closed month, for the report downloads
if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
    sys.exit('--month is YYYY-MM, such as 2026-10')
user, pw = os.environ['PORTAL_USER'], os.environ['PORTAL_PASSWORD']

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, headers=None, timeout=90):
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers or {})
    t0 = time.time()
    try:
        resp = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        resp = err
    return resp, time.time() - t0


def line(label, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ''), flush=True)
    return ok


results = []

# 1. Sign in. The cookie jar keeps the session; a Secure cookie would not be sent over plain http.
resp, dt = call('POST', '/bff/api/auth/login', json.dumps({'username': user, 'password': pw}).encode(),
                {'Content-Type': 'application/json', 'X-HCML-CSRF': '1'})
body = resp.read()
results.append(line('sign-in through nginx', resp.status == 200, f'HTTP {resp.status}, {dt:.2f}s'))
if resp.status != 200:
    print('Stopping: not signed in. Not retrying.')
    sys.exit(1)
for c in jar:
    c.secure = False
print('      cookie set:', sorted({c.name for c in jar}), 'httponly:', all(c.has_nonstandard_attr('HttpOnly') for c in jar))

if not only_mail:
    # 2. Signed-in /api/health and /api/ready.
    resp, dt = call('GET', '/bff/api/health')
    health = json.loads(resp.read() or b'{}')
    results.append(line('signed-in /api/health', resp.status == 200 and health.get('ok') is True, f'HTTP {resp.status}'))
    print('      keys:', sorted(health.keys()))
    for k in ('build', 'version', 'commit', 'builtAt', 'ready', 'model', 'aiProvider', 'aiExternal', 'writeBack'):
        if k in health:
            print(f'      {k}:', json.dumps(health[k])[:160])
    print('      x-request-id header:', bool(resp.headers.get('x-request-id')))

    resp, dt = call('GET', '/bff/api/ready')
    ready_body = resp.read()
    results.append(line('signed-in /api/ready', resp.status in (200, 503), f'HTTP {resp.status}, {dt:.2f}s'))
    print('      body:', ready_body[:300].decode('utf8', 'replace'))

    # 3. Report downloads through nginx's buffer (closed month, both formats).
    for fmt in ('pdf', 'xlsx'):
        resp, dt = call('GET', f'/bff/api/sli/export?month={month}&format={fmt}', timeout=190)
        data = resp.read()
        clen = resp.headers.get('Content-Length')
        disp = resp.headers.get('Content-Disposition') or ''
        ok = resp.status == 200 and len(data) > 1000 and (clen is None or int(clen) == len(data))
        if fmt == 'pdf':
            ok = ok and data.startswith(b'%PDF-') and b'%%EOF' in data[-1100:]
            pages = len(re.findall(rb'/Type\s*/Page[^s]', data))
            extra = f'pages~{pages}'
        else:
            try:
                zf = zipfile.ZipFile(io.BytesIO(data))
                bad = zf.testzip()
                names = zf.namelist()
                sheets = re.findall(r'<sheet [^>]*name="([^"]+)"', zf.read('xl/workbook.xml').decode('utf8', 'replace'))
                ok = ok and bad is None and 'xl/workbook.xml' in names
                extra = f'zip ok={bad is None}, sheets={sheets}'
            except Exception as exc:  # a truncated file is the failure this is looking for
                ok, extra = False, f'not a valid workbook: {type(exc).__name__}'
        results.append(line(f'{fmt} report through nginx', ok,
                            f'HTTP {resp.status}, {len(data)} bytes, Content-Length {clen}, {dt:.1f}s, {extra}'))
        print('      content-type:', resp.headers.get('Content-Type'), '| disposition ok:', 'attachment' in disp,
              '| x-request-id:', bool(resp.headers.get('x-request-id')))
        del data

    # 4. The live stream stays connected through nginx for `secs` seconds and says something at least every 20 s (IN-46).
    spec = importlib.util.spec_from_file_location('sse_hold', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sse_hold.py'))
    sse_hold = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True  # no __pycache__ in the repository
    spec.loader.exec_module(sse_hold)


    def open_stream():
        resp, _ = call('GET', '/bff/api/stream', headers={'Accept': 'text/event-stream'}, timeout=15)
        sse_hold.no_timeout(resp)
        return resp


    stream = sse_hold.hold(open_stream, secs)
    results.append(line('live stream stays connected', stream['ok'], f"HTTP {stream['status']}, " + sse_hold.summary(stream, secs)))
    print('      content-type:', stream['content_type'], '| x-request-id:', stream['request_id'])

    # 5. Problems list, the page that was not exercised.
    resp, dt = call('GET', '/bff/api/problems?limit=5')
    pb = resp.read()
    results.append(line('problems list', resp.status == 200, f'HTTP {resp.status}, {len(pb)} bytes, {dt:.2f}s'))

# 6. Email, the monthly schedule and the CSV files, which the checks above never touched (IN-65). Counts only: no address is printed.
want = {'on': True, 'off': False}.get(expect_mail)


def json_of(resp):
    try:
        body = json.loads(resp.read() or b'{}')
    except ValueError:
        body = {}
    return body if isinstance(body, dict) else {}


resp, dt = call('GET', '/bff/api/sli/email')
mail = json_of(resp)
enabled = mail.get('enabled')
fits = (resp.status == 200 and isinstance(enabled, bool) and isinstance(mail.get('recipients'), list)
        and isinstance(mail.get('allowedDomains'), list) and isinstance(mail.get('max'), int) and isinstance(mail.get('kept'), bool))
results.append(line('email settings (administrator)', fits and (want is None or enabled is want),
                    f"HTTP {resp.status}, enabled={enabled}, expected {expect_mail}, {len(mail.get('allowedDomains') or [])} allowed domain(s), "
                    f"{len(mail.get('recipients') or [])} saved address(es), kept={mail.get('kept')}"))

resp, dt = call('GET', '/bff/api/sli/schedule')
sched = json_of(resp)
available = sched.get('available')
fits = (resp.status == 200 and isinstance(available, bool) and isinstance(sched.get('why'), str) and isinstance(sched.get('recipients'), list)
        and isinstance(sched.get('sends'), list))
results.append(line('monthly schedule (administrator)', fits and (want is None or available is want),
                    f"HTTP {resp.status}, available={available}, expected {expect_mail}, schedule set={sched.get('schedule') is not None}, "
                    f"{len(sched.get('sends') or [])} send(s) recorded" + ('' if available else f", why: {str(sched.get('why'))[:90]}")))

resp, dt = call('GET', f'/bff/api/sli/export?month={month}&format=csv', timeout=190)
data = resp.read()
try:
    zf = zipfile.ZipFile(io.BytesIO(data))
    bad = zf.testzip()
    names = zf.namelist()
    csvs = [n for n in names if n.endswith('.csv')]
    has_notes = any(n.endswith('/notes.txt') or n == 'notes.txt' for n in names)
    ok = resp.status == 200 and len(data) > 500 and bad is None and any(n.endswith('00-summary.csv') for n in names) and has_notes and len(csvs) >= 7
    extra = f'zip ok={bad is None}, {len(csvs)} CSV files, notes present={has_notes}'
except Exception as exc:  # a truncated or missing file is the failure this is looking for
    ok, extra = False, f'not a valid zip: {type(exc).__name__}'
results.append(line('csv report through nginx', ok, f'HTTP {resp.status}, {len(data)} bytes, {dt:.1f}s, {extra}'))
print('      content-type:', resp.headers.get('Content-Type'), '| disposition ok:', 'attachment' in (resp.headers.get('Content-Disposition') or ''))
del data

print(f"\n{sum(results)} of {len(results)} checks passed")
sys.exit(0 if all(results) else 1)

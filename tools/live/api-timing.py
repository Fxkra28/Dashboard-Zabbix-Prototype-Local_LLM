"""Every read endpoint of a dev BFF, cold and warm, with its size raw and gzipped.

    python3 -I tools/live/api-timing.py            (a dev BFF on :4000; BFF=http://127.0.0.1:4001 changes it)

A host, an item of it, a host with network interfaces and a map are taken from the BFF itself unless
HOSTID, ITEMID, IFHOSTID or MAPID name them. The table is also written to api-timing.json (OUT changes the file).
"""
import json, os, subprocess, sys, urllib.request
from datetime import datetime, timedelta, timezone

B = os.environ.get('BFF', 'http://127.0.0.1:4000')

def month_just_closed():
    """YYYY-MM of the month before this one in Asia/Jakarta (UTC+7, no daylight saving), as signedin_check.py works it out."""
    now = datetime.now(timezone(timedelta(hours=7)))
    year, mon = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    return f'{year}-{mon:02d}'

# The portal refuses a month more than about 400 days back, so a fixed one stops working. MONTH names another.
M = os.environ.get('MONTH') or month_just_closed()

def get(path):
    with urllib.request.urlopen(B + path, timeout=170) as r:
        return json.load(r)

def first(path, key):
    try:
        rows = get(path)
        return str(rows[0][key]) if rows else ''
    except Exception:
        return ''

HOSTID = os.environ.get('HOSTID') or first('/api/hosts', 'hostid')
ITEMID = os.environ.get('ITEMID') or first(f'/api/items?hostid={HOSTID}&graphable=1', 'itemid')
IFHOSTID = os.environ.get('IFHOSTID') or first('/api/net/devices', 'hostid')
MAPID = os.environ.get('MAPID') or first('/api/maps', 'sysmapid')
URLS = [
 '/api/health', '/api/ready', '/api/auth/me', '/api/hosts', '/api/hosts/overview', '/api/hostgroups',
 f'/api/items?hostid={HOSTID}', f'/api/items?hostid={HOSTID}&graphable=1', f'/api/latest?hostid={HOSTID}&page=1&pageSize=100',
 '/api/problems', '/api/stats', '/api/freshness', '/api/reports/problems-by-group',
 f'/api/graph?itemids={ITEMID}&month={M}', f'/api/graph?itemids={ITEMID}&hours=24',
 '/api/net/devices', f'/api/net/interfaces?hostid={IFHOSTID}', '/api/links', '/api/sites', '/api/services',
 '/api/reports/top-triggers?days=30', f'/api/reports/availability?month={M}&profile=hcml-report', '/api/reports/availability?days=30',
 '/api/reports/noise?days=30&top=100', '/api/reports/aging', '/api/reports/capacity?days=90', '/api/reports/capacity?days=365',
 '/api/reports/inventory', f'/api/services/derived?month={M}&profile=hcml-report', '/api/sla/source', '/api/sla', f'/api/sli?month={M}&profile=hcml-report',
 f'/api/sli/export?month={M}&format=pdf', f'/api/sli/export?month={M}&format=xlsx', '/api/maps', f'/api/maps/detail?mapid={MAPID}',
]
def hit(u, gz=False):
    cmd = ['curl', '-s', '-o', '/dev/null', '-m', '170', '-w', '%{http_code} %{time_total} %{size_download}', B + u]
    if gz: cmd[1:1] = ['-H', 'Accept-Encoding: gzip']
    r = subprocess.run(cmd, capture_output=True, text=True).stdout.split()
    return (r[0], float(r[1]), int(r[2])) if len(r) == 3 else ('ERR', 0, 0)
print(f"{'endpoint':72s} {'code':>4s} {'cold s':>7s} {'warm s':>7s} {'raw kB':>7s} {'gzip kB':>8s}")
rows = []
for u in URLS:
    c1, t1, s1 = hit(u)
    c2, t2, s2 = hit(u)
    c3, t3, s3 = hit(u, gz=True)
    rows.append((u, c1, t1, t2, s2, s3))
    print(f"{u[:72]:72s} {c1:>4s} {t1:7.2f} {t2:7.2f} {s2/1024:7.1f} {s3/1024:8.1f}", flush=True)
json.dump(rows, open(os.environ.get('OUT', 'api-timing.json'), 'w'))

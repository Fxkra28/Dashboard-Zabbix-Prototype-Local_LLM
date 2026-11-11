"""Hold a server-sent event stream and say whether it stayed alive (tracker.md IN-46).

    python3 -I sse_hold.py URL [--seconds 45] [--quiet-limit 20] [--open-timeout 15] [--cookie NAME=VALUE]

Passes when the first frame arrives, the server never closes the stream, and some line comes at least every
--quiet-limit seconds until --seconds have passed. Read-only: one GET. signedin_check.py uses hold() for its stream step.
A cookie given with --cookie shows in `ps`; the environment variable SSE_HOLD_COOKIE does not.
"""
import argparse
import http.client
import os
import queue
import socket
import sys
import threading
import time
import urllib.error
import urllib.request


def no_timeout(resp):
    """Lift the connect timeout: a reader that has timed out once refuses every later read, so a quiet line would end the check."""
    try:
        resp.fp.raw._sock.settimeout(None)
    except AttributeError:
        pass  # then a quiet line ends the read with an error, which hold() reports as a failure


def drop(resp):
    """End the connection while a thread waits in readline(): closing the reader would wait for that read, so the socket goes first."""
    try:
        resp.fp.raw._sock.shutdown(socket.SHUT_RDWR)
    except (AttributeError, OSError):
        pass
    closer = threading.Thread(target=resp.close, daemon=True)
    closer.start()
    closer.join(1)


def hold(open_stream, seconds, quiet_limit=20.0):
    """Read the stream for `seconds`. open_stream() returns a response with a blocking readline(), close(), status and headers."""
    resp = open_stream()
    headers = getattr(resp, 'headers', None)
    result = {
        'ok': False, 'status': getattr(resp, 'status', None), 'held': 0.0, 'frames': 0, 'events': {},
        'largest': 0, 'longest_quiet': 0.0, 'problem': None,
        'content_type': headers.get('Content-Type') if headers else None,
        'request_id': bool(headers.get('x-request-id')) if headers else False,
    }
    if result['status'] not in (None, 200):
        result['problem'] = f"HTTP {result['status']}"
        resp.close()
        return result
    lines = queue.Queue()

    def read():
        try:
            while True:
                raw = resp.readline()
                lines.put(raw)
                if raw == b'':
                    return
        except Exception as exc:  # the line broke
            lines.put(exc)

    threading.Thread(target=read, daemon=True).start()
    start = last = time.monotonic()
    try:
        while time.monotonic() - start < seconds:
            if time.monotonic() - last > quiet_limit:
                result['problem'] = f'quiet for more than {quiet_limit:g} s'
                break
            try:
                raw = lines.get(timeout=0.2)
            except queue.Empty:
                continue
            now = time.monotonic()
            if isinstance(raw, Exception):
                result['problem'] = f'the line broke ({type(raw).__name__})'
                break
            if raw == b'':
                result['problem'] = 'the server closed the stream'
                break
            result['longest_quiet'] = max(result['longest_quiet'], now - last)
            last = now
            text = raw.decode('utf8', 'replace').rstrip('\r\n')
            if text.startswith('event:'):
                name = text.split(':', 1)[1].strip()
                result['events'][name] = result['events'].get(name, 0) + 1
            elif text.startswith('data:'):
                result['frames'] += 1
                result['largest'] = max(result['largest'], len(text))
    finally:
        result['held'] = time.monotonic() - start
        drop(resp)
    if result['problem'] is None and result['frames'] == 0:
        result['problem'] = 'no frame came'
    result['ok'] = result['problem'] is None
    return result


def summary(r, seconds):
    text = (f"held {r['held']:.0f}s of {seconds:g}s, data frames {r['frames']}, events {r['events']}, "
            f"longest quiet {r['longest_quiet']:.1f}s, largest frame {r['largest']} bytes")
    return text if r['ok'] else f"{text}; {r['problem']}"


def main(argv):
    ap = argparse.ArgumentParser(description='Hold a server-sent event stream.')
    ap.add_argument('url')
    ap.add_argument('--seconds', type=float, default=45)
    ap.add_argument('--quiet-limit', type=float, default=20)
    ap.add_argument('--open-timeout', type=float, default=15)
    ap.add_argument('--cookie')
    a = ap.parse_args(argv)
    headers = {'Accept': 'text/event-stream'}
    cookie = a.cookie or os.environ.get('SSE_HOLD_COOKIE')
    if cookie:
        headers['Cookie'] = cookie

    def open_stream():
        try:
            resp = urllib.request.urlopen(urllib.request.Request(a.url, headers=headers), timeout=a.open_timeout)
        except urllib.error.HTTPError as err:
            return err
        no_timeout(resp)
        return resp

    try:
        result = hold(open_stream, a.seconds, a.quiet_limit)
    except (OSError, ValueError, http.client.HTTPException) as exc:
        print(f'FAIL  could not open the stream ({type(exc).__name__})')
        return 1
    print(('PASS  ' if result['ok'] else 'FAIL  ') + summary(result, a.seconds))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

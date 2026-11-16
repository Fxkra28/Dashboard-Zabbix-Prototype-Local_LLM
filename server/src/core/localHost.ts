/** Whether a model's base URL names this machine or its own network (SC-53). A public name or address, or one this cannot read, counts as outside. */

/** Names that only resolve inside a network (mDNS, RFC 6761 and 8375, and the old Windows and Linux defaults). */
const LOCAL_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa', '.localdomain'];

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Loopback, the three private ranges of RFC 1918, and link-local. */
const privateV4 = ([a, b]: number[]) =>
  a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);

export function isLocalBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  const v4 = ipv4(host);
  if (v4) return privateV4(v4);
  // IPv6: loopback, unique local (fc00::/7) and link-local (fe80::/10).
  if (host.includes(':')) return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  if (host === 'localhost' || host === 'host.docker.internal') return true;
  // One label, such as a Docker service name or a LAN host name: a public name always has a dot.
  if (!host.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

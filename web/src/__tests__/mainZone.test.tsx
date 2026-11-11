import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { reportTimeZone, setReportTimeZone } from '../shared/lib/time';

/**
 * main.tsx asks /api/health once at load, so a page that never
 * asks for capabilities itself (Problems, Hosts) still shows times in the
 * server's zone and not in the default.
 */

vi.mock('../App', () => ({ default: () => null }));
vi.mock('../features/shell/ErrorBoundary', () => ({ reloadOnStaleChunks: vi.fn() }));

afterEach(() => {
  setReportTimeZone(undefined);
  vi.restoreAllMocks();
});

it('learns the server zone as the app loads, before any page asks', async () => {
  const health = vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    ts: 1,
    ai: false,
    writeBack: false,
    defaults: { availabilityMinSeverity: 2, timezone: 'Asia/Makassar' },
  } as Awaited<ReturnType<typeof api.health>>);
  document.body.innerHTML = '<div id="root"></div>';
  expect(reportTimeZone()).toBe('Asia/Jakarta');

  await import('../main');

  await vi.waitFor(() => expect(reportTimeZone()).toBe('Asia/Makassar'));
  expect(health).toHaveBeenCalledTimes(1);
});

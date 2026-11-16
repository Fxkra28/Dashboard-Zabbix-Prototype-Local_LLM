import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import AvailabilityRedirect from './AvailabilityRedirect';

// The Availability & response page was folded into the SLA page. Its old address still opens, because people have bookmarks and the handbook linked to it.

function go(from: string) {
  const router = createMemoryRouter(
    [
      { path: '/before', element: <p>the page before</p> },
      { path: '/reports/availability', element: <AvailabilityRedirect /> },
      { path: '/sla', element: <p>the SLA page</p> },
    ],
    { initialEntries: ['/before', from], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const where = (router: ReturnType<typeof go>) => `${router.state.location.pathname}${router.state.location.search}`;

describe('the old Availability address', () => {
  it('opens the derived view of the SLA page on the last 7 days, which the old page showed when the address named no period', () => {
    expect(where(go('/reports/availability'))).toBe('/sla?month=d7&tab=derived');
  });

  it('always names the derived tab, so that a Zabbix with SLAs of its own does not open on its own tab instead', () => {
    for (const from of ['/reports/availability', '/reports/availability?period=d30', '/reports/availability?period=m:2026-10&method=hcml-report']) {
      expect(new URLSearchParams(where(go(from)).split('?')[1]).get('tab')).toBe('derived');
    }
  });

  it('replaces itself in the history, so Back goes to the page before and not into the redirect again', async () => {
    const router = go('/reports/availability');
    expect(router.state.historyAction).toBe('REPLACE');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/before');
  });

  it('carries a rolling window over to the SLA period', () => {
    expect(where(go('/reports/availability?period=d7'))).toBe('/sla?month=d7&tab=derived');
    expect(where(go('/reports/availability?period=d30'))).toBe('/sla?month=d30&tab=derived');
  });

  it('carries a calendar month over, without the "m:" the old page put before it', () => {
    expect(where(go('/reports/availability?period=m:2026-10'))).toBe('/sla?month=2026-10&tab=derived');
  });

  it('carries the method over', () => {
    expect(where(go('/reports/availability?period=d7&method=hcml-report'))).toBe('/sla?month=d7&method=hcml-report&tab=derived');
    expect(where(go('/reports/availability?method=availability'))).toBe('/sla?month=d7&method=availability&tab=derived');
  });

  it('reads a period or a method it does not know as the old page did, as its default, and does not pass the text on', () => {
    expect(where(go('/reports/availability?period=zzz&method=nonsense'))).toBe('/sla?month=d7&tab=derived');
    expect(where(go('/reports/availability?period=m:2026-13'))).toBe('/sla?month=d7&tab=derived');
    expect(where(go('/reports/availability?period=d99'))).toBe('/sla?month=d7&tab=derived');
  });

  it('drops what the SLA page has no use for: the legacy basis and its severity', () => {
    expect(where(go('/reports/availability?period=d7&basis=all-problems&severity=3'))).toBe('/sla?month=d7&tab=derived');
  });
});

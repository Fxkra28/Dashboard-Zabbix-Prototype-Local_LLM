import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import { RefreshFailed } from '../shared/components/states';
import { SliPill } from '../features/sla/Sli';
import Sites from '../features/network/Sites';
import type { SitesResponse } from '../types';

/**
 * A tooltip is for a mouse. A fact that was only in one (why a refresh failed, that a figure rests on
 * partial data, what "degraded" means) is also in the text a screen reader reads (UX-18), and the
 * tooltip stays.
 */

describe('a refresh that failed', () => {
  it('gives the cause as text, beside the tooltip that already had it', () => {
    render(<RefreshFailed error="Request timed out" updatedAt={Date.UTC(2026, 9, 13, 3, 4)} />);
    const note = screen.getByRole('status');
    expect(note).toHaveAttribute('title', 'Request timed out');
    expect(within(note).getByText('. Request timed out')).toHaveClass('sr-only');
    // 03:04 UTC is 10:04 in Jakarta, wherever this machine is: the time printed is the report zone's, with its name.
    expect(note).toHaveTextContent('Refresh failed: showing data from 10:04 WIB');
  });
});

describe('a figure measured on partial data', () => {
  it('says so in words, and hides the asterisk that stood for it', () => {
    render(<SliPill sli={99.5} target={99} dataStatus="partial" />);
    const pill = screen.getByText(/Met/);
    expect(pill).toHaveAttribute('title', 'Measured on partial data');
    expect(within(pill).getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(within(pill).getByText('(measured on partial data)', { exact: false })).toHaveClass('sr-only');
    expect(pill).toHaveTextContent('99.50%');
    expect(pill).toHaveTextContent(/Met$/);
  });

  it('adds nothing for a figure on full data', () => {
    render(<SliPill sli={99.5} target={99} dataStatus="ok" />);
    const pill = screen.getByText(/Met/);
    expect(pill).not.toHaveTextContent(/partial/);
    expect(pill.querySelector('.sr-only')).toBeNull();
    expect(pill).toHaveTextContent('99.50% Met');
  });
});

describe('the degraded count on a site card', () => {
  beforeEach(() => {
    resetAuthProbe();
    vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: true, user: { name: 'x', role: 'admin' }, expiresIn: 3600 });
    vi.spyOn(api, 'health').mockResolvedValue({} as never);
    const site = {
      name: 'Jakarta', total: 3, available: 2, unavailable: 0, unknown: 0, maintenance: 0, disabled: 0, degraded: 1, problems: 0,
      unacknowledged: 0, bySeverity: {}, worst: -1, hosts: [],
    };
    vi.spyOn(api, 'sites').mockResolvedValue({ sites: [site], coverage: { hosts: 3, tag: 0, name: 3, inventory: 0, group: 0 } } as unknown as SitesResponse);
  });
  afterEach(() => vi.restoreAllMocks());

  it('explains what degraded means as text, beside the tooltip', async () => {
    window.history.replaceState(null, '', '/sites');
    render(
      <BrowserRouter>
        <Sites />
      </BrowserRouter>,
    );
    const degraded = (await screen.findByText(/1 degraded/)).closest('.degraded') as HTMLElement;
    expect(degraded).toHaveAttribute('title', 'Answer ping, but SNMP polling or the Zabbix agent is silent');
    expect(degraded.querySelector('.sr-only')).toHaveTextContent('they answer ping, but SNMP polling or the Zabbix agent is silent');
  });
});

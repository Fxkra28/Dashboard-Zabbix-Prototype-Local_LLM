import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import type { SlaSource } from '../../types';

// Both panels fetch on mount; what they show is not under test, so they never answer.
const never = () => new Promise<never>(() => undefined);

function show(source: SlaSource) {
  vi.spyOn(api, 'slaSource').mockResolvedValue(source);
  vi.spyOn(api, 'sla').mockImplementation(never);
  vi.spyOn(api, 'sli').mockImplementation(never);
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.health>>);
  return render(
    <BrowserRouter>
      <Sla />
    </BrowserRouter>,
  );
}

const real: SlaSource = { real: true, slas: 2, services: 5 } as SlaSource;
const tab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => window.history.replaceState(null, '', '/sla'));
afterEach(() => vi.restoreAllMocks());

describe('the SLA source tabs (UX-18)', () => {
  it('has a tab list of two tabs and a panel the selected one controls', async () => {
    show(real);
    const zabbix = await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    expect(screen.getByRole('tablist', { name: 'SLA source' })).toBeInTheDocument();
    expect(zabbix).toHaveAttribute('aria-selected', 'true');
    expect(tab('Derived monthly SLA')).toHaveAttribute('aria-selected', 'false');

    const panel = screen.getByRole('tabpanel');
    expect(zabbix.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel).toHaveAccessibleName('Zabbix SLAs');
  });

  it('is one tab stop: only the selected tab can be reached with Tab', async () => {
    show(real);
    await screen.findByRole('tablist');
    expect(tab('Zabbix SLAs')).toHaveAttribute('tabindex', '0');
    expect(tab('Derived monthly SLA')).toHaveAttribute('tabindex', '-1');
  });

  it('moves between the tabs with the arrow keys, wrapping at both ends, and focus follows', async () => {
    const user = userEvent.setup();
    show(real);
    await screen.findByRole('tablist');
    tab('Zabbix SLAs').focus();

    await user.keyboard('{ArrowLeft}');
    expect(tab('Derived monthly SLA')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Derived monthly SLA')).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Derived monthly SLA');

    await user.keyboard('{ArrowLeft}');
    expect(tab('Zabbix SLAs')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Derived monthly SLA')).toHaveFocus();
  });

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup();
    show(real);
    await screen.findByRole('tablist');
    tab('Zabbix SLAs').focus();
    await user.keyboard('{Home}');
    expect(tab('Derived monthly SLA')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Zabbix SLAs')).toHaveFocus();
    expect(tab('Zabbix SLAs')).toHaveAttribute('aria-selected', 'true');
  });

  it('still switches on a click', async () => {
    const user = userEvent.setup();
    show(real);
    await user.click(await screen.findByRole('tab', { name: 'Derived monthly SLA' }));
    expect(tab('Derived monthly SLA')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?tab=derived');
  });

  it('shows no tabs and no panel when Zabbix has no SLA data of its own', async () => {
    show({ real: false, slas: 0, services: 0 } as SlaSource);
    await screen.findByText(/so this page shows the SLA derived in the portal/);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('asks for the derived report once when ?tab=derived is open and the source answers later', async () => {
    window.history.replaceState(null, '', '/sla?tab=derived');
    let answer!: (s: SlaSource) => void;
    vi.spyOn(api, 'slaSource').mockReturnValue(new Promise<SlaSource>((r) => (answer = r)));
    const sli = vi.spyOn(api, 'sli').mockImplementation(never);
    vi.spyOn(api, 'sla').mockImplementation(never);
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.health>>);
    render(
      <BrowserRouter>
        <Sla />
      </BrowserRouter>,
    );
    await waitFor(() => expect(sli).toHaveBeenCalled());
    const before = sli.mock.calls.length;

    answer(real);
    await screen.findByRole('tablist');
    // The tab list appearing must not remount the panel: a remount asks for the same report again.
    await new Promise((r) => setTimeout(r, 30));
    expect(sli.mock.calls.length).toBe(before);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Sla from './Sla';
import { lastClosedMonth } from './Sli';
import type { SlaSource } from '../../types';

// The panels fetch on mount; what they show is not under test, so they never answer.
const never = () => new Promise<never>(() => undefined);

function show(source: SlaSource) {
  vi.spyOn(api, 'slaSource').mockResolvedValue(source);
  vi.spyOn(api, 'sla').mockImplementation(never);
  vi.spyOn(api, 'sli').mockImplementation(never);
  vi.spyOn(api, 'aging').mockImplementation(never);
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

describe('the SLA view tabs (UX-18)', () => {
  it('has a tab list of three tabs, in the order derived, Zabbix, Response, and a panel the selected one controls', async () => {
    show(real);
    const zabbix = await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    expect(screen.getByRole('tablist', { name: 'SLA view' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Derived SLA', 'Zabbix SLAs', 'Response']);
    expect(zabbix).toHaveAttribute('aria-selected', 'true');
    expect(tab('Derived SLA')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Response')).toHaveAttribute('aria-selected', 'false');

    const panel = screen.getByRole('tabpanel');
    expect(zabbix.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel).toHaveAccessibleName('Zabbix SLAs');
  });

  it('is one tab stop: only the selected tab can be reached with Tab', async () => {
    show(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    expect(tab('Zabbix SLAs')).toHaveAttribute('tabindex', '0');
    expect(tab('Derived SLA')).toHaveAttribute('tabindex', '-1');
    expect(tab('Response')).toHaveAttribute('tabindex', '-1');
  });

  it('moves between the tabs with the arrow keys, wrapping at both ends, and focus follows', async () => {
    const user = userEvent.setup();
    show(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    tab('Zabbix SLAs').focus();

    await user.keyboard('{ArrowLeft}');
    expect(tab('Derived SLA')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Derived SLA')).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Derived SLA');

    await user.keyboard('{ArrowLeft}');
    expect(tab('Response')).toHaveFocus();
    expect(tab('Response')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Derived SLA')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Zabbix SLAs')).toHaveFocus();
  });

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup();
    show(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    tab('Zabbix SLAs').focus();
    await user.keyboard('{Home}');
    expect(tab('Derived SLA')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Response')).toHaveFocus();
    expect(tab('Response')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Response');
  });

  it('still switches on a click, and writes the choice into the address', async () => {
    const user = userEvent.setup();
    show(real);
    await user.click(await screen.findByRole('tab', { name: 'Derived SLA' }));
    expect(tab('Derived SLA')).toHaveAttribute('aria-selected', 'true');
    // The derived view writes its month into the address (FR-53), and it stays there as the tab changes.
    expect(window.location.search).toBe(`?month=${lastClosedMonth()}&tab=derived`);
    await user.click(tab('Response'));
    expect(window.location.search).toBe(`?month=${lastClosedMonth()}&tab=response`);
  });

  it('shows the derived tab and the Response tab, and no Zabbix tab, when Zabbix has no SLA data of its own', async () => {
    show({ real: false, slas: 0, services: 0 } as SlaSource);
    await screen.findByText(/so this page shows the SLA derived in the portal/);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Derived SLA', 'Response']);
    expect(tab('Derived SLA')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Derived SLA');
  });

  it('opens the Response tab from the address even when Zabbix has SLAs of its own', async () => {
    window.history.replaceState(null, '', '/sla?tab=response');
    show(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    expect(tab('Response')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Zabbix SLAs')).toHaveAttribute('aria-selected', 'false');
  });

  it('opens the derived tab for ?tab=zabbix when Zabbix has no SLAs, and says so by selecting it', async () => {
    window.history.replaceState(null, '', '/sla?tab=zabbix');
    show({ real: false, slas: 0, services: 0 } as SlaSource);
    await screen.findByText(/so this page shows the SLA derived in the portal/);
    expect(tab('Derived SLA')).toHaveAttribute('aria-selected', 'true');
  });

  it('asks for the derived report once when ?tab=derived is open and the source answers later', async () => {
    window.history.replaceState(null, '', '/sla?tab=derived');
    let answer!: (s: SlaSource) => void;
    vi.spyOn(api, 'slaSource').mockReturnValue(new Promise<SlaSource>((r) => (answer = r)));
    const sli = vi.spyOn(api, 'sli').mockImplementation(never);
    vi.spyOn(api, 'sla').mockImplementation(never);
    vi.spyOn(api, 'aging').mockImplementation(never);
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.health>>);
    render(
      <BrowserRouter>
        <Sla />
      </BrowserRouter>,
    );
    await waitFor(() => expect(sli).toHaveBeenCalled());
    const before = sli.mock.calls.length;

    answer(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    // The Zabbix tab appearing must not remount the panel: a remount asks for the same report again.
    await new Promise((r) => setTimeout(r, 30));
    expect(sli.mock.calls.length).toBe(before);
  });
});

describe('the SLA view tabs when Zabbix has no SLAs of its own, as HCML has today', () => {
  it('walks between the two tabs with the arrow keys, wrapping, and Home and End land on the ends', async () => {
    const user = userEvent.setup();
    show({ real: false, slas: 0, services: 0 } as SlaSource);
    await screen.findByText(/so this page shows the SLA derived in the portal/);
    tab('Derived SLA').focus();

    await user.keyboard('{ArrowRight}');
    expect(tab('Response')).toHaveFocus();
    expect(tab('Response')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Derived SLA')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Response')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Derived SLA')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Response')).toHaveFocus();
  });
});

describe('the keys the browser keeps for itself', () => {
  it('leaves Alt and Cmd with an arrow alone, since they go back and forward in the browser, and Ctrl with an arrow too', async () => {
    const user = userEvent.setup();
    show(real);
    await screen.findByRole('tab', { name: 'Zabbix SLAs' });
    tab('Zabbix SLAs').focus();
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}');
    await user.keyboard('{Control>}{ArrowLeft}{/Control}');
    await user.keyboard('{Alt>}{Home}{/Alt}');
    expect(tab('Zabbix SLAs')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Zabbix SLAs')).toHaveFocus();
  });
});

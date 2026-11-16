import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Services from './Services';
import type { DerivedServicesResponse, ServiceNode, ServicesResponse, SliProfile } from '../../types';

const node = (name: string, over: Partial<ServiceNode> = {}): ServiceNode => ({
  serviceid: name,
  name,
  status: -1,
  algorithm: '0',
  tags: [],
  problems: [],
  children: [],
  worst: -1,
  descendants: 0,
  ...over,
});

const tree = (...names: string[]): ServicesResponse => ({
  tree: names.map((n) => node(n)),
  total: names.length,
  degraded: 0,
  worst: -1,
});

let services: MockInstance<typeof api.services>;
let derived: MockInstance<typeof api.servicesDerived>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(api, 'health').mockResolvedValue({} as never);
  services = vi.spyOn(api, 'services');
  // The derived page's own answer never matters here, only that it is asked for.
  derived = vi.spyOn(api, 'servicesDerived').mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = () => act(async () => undefined);
const minute = () => act(async () => void vi.advanceTimersByTime(60_000));

describe('the Services tree from Zabbix (FR-12)', () => {
  it('refreshes every minute, like the other pages', async () => {
    services.mockResolvedValueOnce(tree('Voice path')).mockResolvedValueOnce(tree('Voice path', 'Data path'));
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    expect(screen.getByText('Voice path')).toBeInTheDocument();
    expect(screen.queryByText('Data path')).toBeNull();

    await minute();
    await settle();
    expect(services).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Data path')).toBeInTheDocument();
    expect(derived).not.toHaveBeenCalled();
  });

  it('keeps the branches the person opened or closed when the minute refresh arrives', async () => {
    services.mockImplementation(async () => ({
      ...tree(),
      tree: [node('Core', { children: [node('Leaf')] }), node('Voice', { worst: 2, children: [node('Trunk')] })],
      total: 4,
    }));
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    // The degraded branch opens by itself and the healthy one is folded.
    expect(screen.getByText('Trunk')).toBeInTheDocument();
    expect(screen.queryByText('Leaf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Core' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Voice' }));
    await minute();
    await settle();

    expect(services).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Leaf')).toBeInTheDocument();
    expect(screen.queryByText('Trunk')).toBeNull();
  });

  it('offers "Expand all" when a branch is folded, even if as many are open as there are branches (FR-24)', async () => {
    const branch = (name: string) => node(name, { children: [node(`${name} leaf`)] });
    services
      .mockResolvedValueOnce({ ...tree(), tree: [branch('A'), branch('B'), branch('C')], total: 6 })
      .mockResolvedValue({ ...tree(), tree: [branch('A'), branch('B'), branch('D')], total: 6 });
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();

    // The next answer has no C and a new D, folded: the open set still holds C, so it is as big as before.
    await minute();
    await settle();
    expect(screen.queryByText('D leaf')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('D leaf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
  });

  it('stays on the Zabbix tree when a later answer has no services: the first answer decided', async () => {
    services.mockResolvedValueOnce(tree('Voice path')).mockResolvedValue(tree());
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    await minute();
    await settle();
    expect(services).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/No services are defined in Zabbix yet/)).toBeInTheDocument();
    expect(derived).not.toHaveBeenCalled();
  });

  it('shows the chip for a missed target as below it, not as the target', async () => {
    const sla = { slaid: '1', name: 'Core', slo: 99, sli: 98.996, errorBudget: -5, meeting: false };
    services.mockResolvedValue({ ...tree(), tree: [node('Core', { sla })], total: 1 });
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    const chip = screen.getByTitle('Target 99%');
    expect(chip).toHaveTextContent('98.996% / 99%');
    expect(chip).toHaveClass('miss');
  });

  it('asks again a minute after a failed first load, instead of staying on the error', async () => {
    services.mockRejectedValueOnce(new Error('Zabbix is unreachable')).mockResolvedValueOnce(tree('Voice path'));
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    expect(screen.getByText('Zabbix is unreachable')).toBeInTheDocument();

    await minute();
    await settle();
    expect(screen.getByText('Voice path')).toBeInTheDocument();
  });
});

describe('the derived tree when Zabbix has no services (FR-12)', () => {
  it('is chosen by the first answer, which is then not asked for again', async () => {
    services.mockResolvedValue(tree());
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    expect(derived).toHaveBeenCalledTimes(1);

    await minute();
    await minute();
    await settle();
    expect(services).toHaveBeenCalledTimes(1);
  });

  it('says why the tree is derived, in the words that are only true when Zabbix has no services', async () => {
    services.mockResolvedValue(tree());
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    expect(document.querySelector('.sli-banner')?.textContent).toContain('Derived from ICMP availability triggers: Zabbix has no services configured.');
  });
});

// UX-56: the Month and Method controls were drawn in one place while a month loaded and in another once it was in, so each change took the focus from the one pressed.
describe('the controls of the derived tree keep the keyboard focus (UX-56)', () => {
  // Month and method are kept in the address, which one test leaves for the next.
  beforeEach(() => window.history.replaceState(null, '', '/'));

  const answer = (month: string, method: SliProfile): DerivedServicesResponse =>
    ({ ...tree('Estate'), month, profile: method, target: 99.5, gaps: [], noDataWindows: [] }) as unknown as DerivedServicesResponse;

  async function openDerived() {
    services.mockResolvedValue(tree());
    // Every month and method is answered after a pause, so that the page is seen loading.
    const releases: (() => void)[] = [];
    derived.mockImplementation(
      (month?: string, method?: SliProfile) =>
        new Promise<DerivedServicesResponse>((resolve) => {
          releases.push(() => resolve(answer(month ?? '', method ?? 'availability')));
        }),
    );
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    await act(async () => releases.shift()?.());
    await settle();
    return releases;
  }

  it('keeps the Month select, the same element and still focused, while the new month loads and when it has arrived', async () => {
    const releases = await openDerived();
    const month = screen.getByLabelText('Month') as HTMLSelectElement;
    month.focus();
    expect(document.activeElement).toBe(month);

    const other = [...month.options].find((o) => o.value !== month.value)!.value;
    fireEvent.change(month, { target: { value: other } });
    await settle();
    expect(screen.getByText('Deriving the service tree…')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toBe(month);
    expect(document.activeElement).toBe(month);

    await act(async () => releases.shift()?.());
    await settle();
    expect(screen.getByText('Estate')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toBe(month);
    expect(document.activeElement).toBe(month);
    expect(month.value).toBe(other);
  });

  it('keeps the Method button the person pressed, while the other method loads and when it has arrived', async () => {
    const releases = await openDerived();
    const strict = screen.getByRole('button', { name: /Strict/ });
    const hcml = screen.getByRole('button', { name: /HCML/ });
    hcml.focus();
    fireEvent.click(hcml);
    await settle();
    expect(screen.getByText('Deriving the service tree…')).toBeInTheDocument();
    expect(document.activeElement).toBe(hcml);

    await act(async () => releases.shift()?.());
    await settle();
    expect(screen.getByText('Estate')).toBeInTheDocument();
    expect(document.activeElement).toBe(hcml);
    expect(hcml).toHaveAttribute('aria-pressed', 'true');
    expect(strict).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the controls once, whatever state the page is in', async () => {
    const releases = await openDerived();
    expect(screen.getAllByLabelText('Month')).toHaveLength(1);
    const options = [...(screen.getByLabelText('Month') as HTMLSelectElement).options];
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: options[options.length - 1].value } });
    await settle();
    expect(screen.getAllByLabelText('Month')).toHaveLength(1);
    await act(async () => releases.shift()?.());
    await settle();
    expect(screen.getAllByLabelText('Month')).toHaveLength(1);
  });

  it('still lets the person pick another month when the read of one has failed', async () => {
    services.mockResolvedValue(tree());
    derived.mockRejectedValueOnce(new Error('Zabbix did not answer')).mockResolvedValue(answer('2026-09', 'availability'));
    render(<Services />, { wrapper: BrowserRouter });
    await settle();
    expect(screen.getByText(/Zabbix did not answer/)).toBeInTheDocument();
    const month = screen.getByLabelText('Month') as HTMLSelectElement;
    const other = [...month.options].find((o) => o.value !== month.value)!.value;
    fireEvent.change(month, { target: { value: other } });
    await settle();
    expect(derived).toHaveBeenLastCalledWith(other, 'availability');
  });
});

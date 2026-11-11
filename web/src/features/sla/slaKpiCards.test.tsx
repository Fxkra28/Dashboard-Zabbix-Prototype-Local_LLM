import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { api } from '../../api';
import Availability from './Availability';
import Sla from './Sla';
import type { AvailabilityReport, SliGroup, SliReport } from '../../types';

// A figure that fell short of the target must not read as the target on the headline cards.
const group = (key: string, name: string, sli: number): SliGroup => ({
  key,
  name,
  hosts: 3,
  withData: 3,
  sli,
  downtime: 60,
  meeting: sli >= 99,
  belowTarget: sli >= 99 ? 0 : 3,
});

const sliReport = (month: string, profile: SliReport['profile']): SliReport =>
  ({
    source: 'derived',
    label: 'Derived',
    profile,
    month,
    from: 0,
    to: 1,
    end: 1,
    closed: true,
    timezone: 'Asia/Jakarta',
    target: 99,
    basis: { triggers: [], gapPolicy: 'excluded', noDataPolicy: 'excluded', maintenancePolicy: 'excluded' },
    overall: group('all', 'Estate', 98.996),
    categories: [],
    sites: [],
    classes: [],
    hosts: [],
    wanPaths: [],
    web: [],
    gaps: [],
    noDataWindows: [],
    stats: { zabbixCalls: 0, triggers: 0, events: 0, trendRows: 0, ms: 0 },
    generatedAt: 0,
  }) as SliReport;

const availability: AvailabilityReport = {
  from: 0,
  to: 1,
  windowSeconds: 1,
  minSeverity: 2,
  hosts: [],
  truncated: false,
  basis: 'availability',
  profile: 'availability',
  month: null,
  target: 99,
  overall: group('all', 'Estate', 98.996),
  categories: [group('net', 'Network', 98.996)],
  sites: [],
  gaps: [],
};

/** The card with this label: its value and its note. */
const card = (label: string) => {
  const found = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.label')?.textContent === label);
  if (!found) throw new Error(`no card labelled ${label}`);
  return found;
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.health>>);
});
afterEach(() => vi.restoreAllMocks());

describe('the SLA page headline cards', () => {
  it('print a missed overall and HCML figure as they are, not as the 99% target', async () => {
    vi.spyOn(api, 'slaSource').mockResolvedValue({ real: false, slas: 0, services: 0 } as never);
    vi.spyOn(api, 'sli').mockImplementation(async (month, profile) => sliReport(month ?? '', profile ?? 'availability'));
    render(
      <BrowserRouter>
        <Sla />
      </BrowserRouter>,
    );
    await screen.findByText('Overall availability (strict)');

    const strict = card('Overall availability (strict)');
    expect(strict.querySelector('.value')).toHaveTextContent('98.996%');
    expect(strict.querySelector('.sub')).toHaveTextContent('missed');

    // The HCML card fills in once its own report has come back.
    await vi.waitFor(() => expect(card('HCML report method').querySelector('.value')).toHaveTextContent('98.996%'));
    expect(card('HCML report method').querySelector('.sub')).toHaveTextContent('missed 99%');
  });
});

describe('the Availability page headline cards', () => {
  it('print a missed overall and category figure as they are, not as the 99% target', async () => {
    vi.spyOn(api, 'availability').mockResolvedValue(availability);
    render(
      <BrowserRouter>
        <Availability />
      </BrowserRouter>,
    );
    await screen.findByText('Overall · Strict');

    expect(card('Overall · Strict').querySelector('.value')).toHaveTextContent('98.996%');
    expect(card('Network').querySelector('.value')).toHaveTextContent('98.996%');
  });
});

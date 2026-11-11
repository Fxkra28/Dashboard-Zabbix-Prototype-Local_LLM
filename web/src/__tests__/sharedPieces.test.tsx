import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { AckPill } from '../features/problems/AckPill';
import { Field, FieldGroup, FieldSpacer } from '../shared/components/Field';
import { HostTable, type HostTableRow } from '../features/hosts/HostTable';
import { Pager } from '../shared/components/Pager';
import type { SiteSource } from '../types';

/**
 * Pieces that were copied across pages now live in one place. The expected strings below are
 * what the copies rendered before the move, so a change in the shared piece shows as a change here.
 */

describe('Field, FieldGroup and FieldSpacer', () => {
  it('Field puts a label above its control, tied to it by id', () => {
    const { container } = render(
      <Field label="Search host" htmlFor="q">
        <input id="q" type="text" />
      </Field>,
    );
    expect(container.innerHTML).toBe('<div class="field"><label for="q">Search host</label><input id="q" type="text"></div>');
    expect(screen.getByLabelText('Search host')).toHaveAttribute('id', 'q');
  });

  it('FieldGroup heads a group of controls with plain text, not a label', () => {
    const { container } = render(
      <FieldGroup label="Filter">
        <button type="button">x</button>
      </FieldGroup>,
    );
    expect(container.innerHTML).toBe('<div class="field"><span class="field-label">Filter</span><button type="button">x</button></div>');
  });

  it('FieldSpacer keeps a hidden heading, so a count or a button sits level with labelled cells', () => {
    const { container } = render(
      <FieldSpacer>
        <span className="pill">3 hosts</span>
      </FieldSpacer>,
    );
    expect(container.innerHTML).toBe(
      '<div class="field"><span class="field-label" aria-hidden="true">&nbsp;</span><span class="pill">3 hosts</span></div>',
    );
    // Said to no one: the heading is empty space.
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(' ');
  });
});

describe('Pager', () => {
  const html = (middle: string) =>
    '<div class="pager"><button type="button" class="btn ghost sm">‹ Prev</button>' +
    `<span class="muted">${middle}</span>` +
    '<button type="button" class="btn ghost sm">Next ›</button></div>';

  it('renders the line the caller words between Prev and Next', () => {
    const { container } = render(
      <Pager page={2} pages={3} onPage={() => undefined}>
        Page {2} of {3}
      </Pager>,
    );
    expect(container.innerHTML).toBe(html('Page 2 of 3'));
  });

  it('takes a range as well as a page count', () => {
    const { container } = render(
      <Pager page={2} pages={3} onPage={() => undefined}>
        {51}{"\u2013"}{100} of {130}
      </Pager>,
    );
    expect(container.innerHTML).toBe(html('51\u2013100 of 130'));
  });

  it('asks for the page before or after, and stops at both ends', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    const { rerender } = render(
      <Pager page={2} pages={3} onPage={onPage}>
        mid
      </Pager>,
    );
    await user.click(screen.getByRole('button', { name: '‹ Prev' }));
    await user.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(onPage.mock.calls).toEqual([[1], [3]]);

    rerender(
      <Pager page={1} pages={3} onPage={onPage}>
        mid
      </Pager>,
    );
    expect(screen.getByRole('button', { name: '‹ Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeEnabled();

    rerender(
      <Pager page={3} pages={3} onPage={onPage}>
        mid
      </Pager>,
    );
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  });
});

describe('AckPill', () => {
  it('says Yes for an acknowledged problem, and No for anything else', () => {
    const yes = render(<AckPill acknowledged="1" />);
    expect(yes.container.innerHTML).toBe('<span class="pill up">Yes</span>');
    const no = render(<AckPill acknowledged="0" />);
    expect(no.container.innerHTML).toBe('<span class="pill">No</span>');
    // Zabbix only sends '0' or '1'; a stray value is not an acknowledgement.
    expect(render(<AckPill acknowledged="" />).container.innerHTML).toBe('<span class="pill">No</span>');
  });
});

describe('HostTable', () => {
  const none = { total: 0, bySeverity: {} };
  const rows: HostTableRow[] = [
    {
      hostid: '1',
      name: 'core-1',
      status: '0',
      interfaces: [{ ip: '10.0.0.1', type: '2' }],
      problems: { total: 3, bySeverity: { '4': 2, '2': 1 } },
      state: 'up',
      reason: 'ping',
      siteSource: 'tag',
    },
    { hostid: '2', name: 'edge-2', status: '1', interfaces: [], problems: none, state: 'disabled', reason: 'disabled', siteSource: 'name' },
    {
      hostid: '3',
      name: 'mnt-3',
      status: '0',
      maintenance_status: '1',
      interfaces: [{ ip: '10.0.0.3', type: '1', available: '2' }],
      problems: none,
      state: 'degraded',
      reason: 'agent-silent',
      siteSource: 'inventory',
    },
  ];
  const show = (ui: React.ReactElement) => render(<BrowserRouter>{ui}</BrowserRouter>);

  const head = (extra: string) =>
    '<thead><tr><th>Host</th><th>Interface</th><th>Availability</th><th>Status</th><th>Problems</th>' +
    `${extra}<th class="sticky-end"><span class="sr-only">Actions</span></th></tr></thead>`;
  const graphs = (id: string) => `<td class="sticky-end"><a class="btn ghost sm" href="/graphs?hostid=${id}" data-discover="true">Graphs</a></td>`;
  // The two rows without problem chips, as the Hosts page drew them before the table was shared.
  const edge = (from: string) =>
    '<tr><td style="font-weight: 500;">edge-2</td>' +
    '<td class="muted mono"><span aria-hidden="true">\u2014</span><span class="sr-only">No data</span></td>' +
    '<td><span class="pill " title="Monitoring is disabled for this host in Zabbix"><span class="dot" style="background: var(--muted);"></span> Disabled</span></td>' +
    '<td><span class="pill">Disabled</span></td><td><span class="muted">None</span></td>' +
    `${from}${graphs('2')}</tr>`;
  const maintenance = (from: string) =>
    '<tr><td style="font-weight: 500;">mnt-3</td><td class="muted mono">10.0.0.3 · Agent</td>' +
    '<td><span class="pill degraded" title="Answers ping, but the Zabbix agent is not reporting"><span class="dot" style="background: var(--warn);"></span> Agent silent</span></td>' +
    '<td><span class="pill">Maintenance</span></td><td><span class="muted">None</span></td>' +
    `${from}${graphs('3')}</tr>`;

  it('draws the Hosts page table: six columns, one row per host', () => {
    const { container } = show(<HostTable hosts={rows.slice(1)} />);
    expect(container.innerHTML).toBe(
      `<div class="table-wrap"><table class="data">${head('')}<tbody>${edge('')}${maintenance('')}</tbody></table></div>`,
    );
  });

  it('adds the "Site from" column for a site, and says where each site came from', () => {
    const { container } = show(<HostTable hosts={rows.slice(1)} siteFrom />);
    expect(container.innerHTML).toBe(
      `<div class="table-wrap"><table class="data">${head('<th>Site from</th>')}<tbody>` +
        `${edge('<td><span class="site-src name">from host name</span></td>')}` +
        `${maintenance('<td><span class="site-src inventory">inventory</span></td>')}</tbody></table></div>`,
    );
  });

  it('shows a source it has no words for as it arrived', () => {
    const odd = [{ ...rows[1], siteSource: 'registry' as SiteSource }];
    show(<HostTable hosts={odd} siteFrom />);
    expect(screen.getByText('registry')).toHaveClass('site-src', 'registry');
  });

  it('shows a host with problems as chips and a count, and links to its graphs', () => {
    show(<HostTable hosts={rows.slice(0, 1)} />);
    const row = screen.getByRole('row', { name: /core-1/ });
    expect(within(row).getByText('10.0.0.1 · SNMP')).toBeInTheDocument();
    expect(within(row).getByText('Monitored')).toHaveClass('pill', 'up');
    expect(within(row).getByText('(3)')).toHaveClass('muted');
    expect(within(row).getByTitle('High')).toHaveTextContent('2');
    expect(within(row).getByTitle('Warning')).toHaveTextContent('1');
    expect(within(row).getByRole('link', { name: 'Graphs' })).toHaveAttribute('href', '/graphs?hostid=1');
  });

  it('draws an empty list as a header and no rows', () => {
    const { container } = show(<HostTable hosts={[]} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.querySelectorAll('thead th')).toHaveLength(6);
  });
});

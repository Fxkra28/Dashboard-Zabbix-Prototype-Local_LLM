import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';
import type { Me, Role } from '../../types';

// The health probe is cached for the life of the module, so the test sets what it reports directly.
const caps = { ai: false, writeBack: false, availabilityMinSeverity: 2 };
vi.mock('../assistant/useAi', () => ({ useCapabilities: () => caps }));
const { default: Sidebar, PAGE_TITLES } = await import('./Sidebar');

const everyPage = (role: Role) => Object.fromEntries(Object.keys(PAGE_TITLES).map((p) => [p, role]));
const answer = (role: Role, pages?: Record<string, Role>): Me => ({
  authEnabled: true,
  user: { name: 'x', role },
  expiresIn: 3600,
  ...(pages ? { pages } : {}),
});

function show() {
  return render(
    <MemoryRouter>
      <Sidebar collapsed={false} onToggle={() => undefined} />
    </MemoryRouter>,
  );
}
const link = (name: string) => screen.queryByRole('link', { name });

beforeEach(() => {
  resetAuthProbe();
  caps.writeBack = false;
});
afterEach(() => vi.restoreAllMocks());

describe('the sidebar menu', () => {
  it('follows the role table the server sends, not a table of its own', async () => {
    // Deliberately the opposite of the real rules: Network open to a viewer, Hosts for an admin only.
    const pages = { ...everyPage('viewer'), '/network': 'viewer', '/hosts': 'admin', '/sla': 'operator' } as Record<string, Role>;
    vi.spyOn(api, 'me').mockResolvedValue(answer('viewer', pages));
    show();
    expect(await screen.findByRole('link', { name: 'Network' })).toBeInTheDocument();
    expect(link('Hosts')).toBeNull();
    expect(link('SLA')).toBeNull();
    expect(link('Problems')).toBeInTheDocument();
  });

  it('shows a page once the signed-in role reaches the role the server asks for', async () => {
    const pages = { ...everyPage('viewer'), '/network': 'operator', '/reports/inventory': 'admin' } as Record<string, Role>;
    vi.spyOn(api, 'me').mockResolvedValue(answer('operator', pages));
    show();
    expect(await screen.findByRole('link', { name: 'Network' })).toBeInTheDocument();
    expect(link('Inventory & ownership scorecard')).toBeNull();
  });

  it('offers nothing until the server has answered', async () => {
    let answerLater!: (m: Me) => void;
    vi.spyOn(api, 'me').mockReturnValue(new Promise<Me>((resolve) => (answerLater = resolve)));
    show();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    answerLater(answer('viewer', everyPage('viewer')));
    expect(await screen.findByRole('link', { name: 'Problems' })).toBeInTheDocument();
  });

  it('shows the white logo on the chrome and names HCML once', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer('viewer', everyPage('viewer')));
    show();
    await screen.findByRole('link', { name: 'Problems' });
    expect(screen.getByRole('img', { name: 'HCML' })).toHaveAttribute('src', '/logo-white.png');
    expect(screen.queryByText('HCML')).toBeNull();
  });

  it('hides a page the server table does not list, so a forgotten entry never opens a door', async () => {
    const pages = Object.fromEntries(Object.entries(everyPage('viewer')).filter(([page]) => page !== '/links'));
    vi.spyOn(api, 'me').mockResolvedValue(answer('admin', pages));
    show();
    await screen.findByRole('link', { name: 'Problems' });
    expect(link('Links & WAN health')).toBeNull();
  });

  it('offers every page to a BFF that predates the table, which still refuses what the role may not open', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer('viewer'));
    show();
    expect(await screen.findByRole('link', { name: 'Network' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBe(Object.keys(PAGE_TITLES).length);
  });
});

describe('the sidebar footer', () => {
  it('says acknowledge is the exception for an operator on a portal that has it on', async () => {
    caps.writeBack = true;
    vi.spyOn(api, 'me').mockResolvedValue(answer('operator', everyPage('viewer')));
    show();
    expect(await screen.findByText(/^Read-only except acknowledge/)).toBeInTheDocument();
  });

  it('says plain read-only to a viewer, and to an operator when acknowledge is off, with no API in it', async () => {
    caps.writeBack = true;
    vi.spyOn(api, 'me').mockResolvedValue(answer('viewer', everyPage('viewer')));
    const first = show();
    const text = (await screen.findByText(/^Read-only/)).textContent;
    expect(text).toBe('Read-only · powered by Zabbix');
    first.unmount();

    resetAuthProbe();
    caps.writeBack = false;
    vi.spyOn(api, 'me').mockResolvedValue(answer('operator', everyPage('viewer')));
    show();
    expect((await screen.findByText(/^Read-only/)).textContent).toBe('Read-only · powered by Zabbix');
  });
});

describe('the build line in the footer (IN-01)', () => {
  const STAMPED = { ok: true, ts: 1, ai: false, writeBack: false, build: { commit: 'abc1234', time: '2026-10-07T09:19:57Z' } };

  it('shows the build the BFF reports, once someone is signed in', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer('admin', everyPage('viewer')));
    const health = vi.spyOn(api, 'health').mockResolvedValue(STAMPED);
    show();
    expect(await screen.findByText(/^Build abc1234, /)).toBeInTheDocument();
    expect(health).toHaveBeenCalledTimes(1);
  });

  it('does not ask before the server has said who is signed in, since only a signed-in answer carries it', async () => {
    vi.spyOn(api, 'me').mockReturnValue(new Promise<Me>(() => undefined));
    const health = vi.spyOn(api, 'health').mockResolvedValue(STAMPED);
    show();
    await Promise.resolve();
    expect(health).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Build /)).toBeNull();
  });

  it('shows no line for a BFF that sends no build, or one that was never stamped, or one that does not answer', async () => {
    for (const reply of [{ ok: true, ts: 1, ai: false, writeBack: false }, { ...STAMPED, build: { commit: 'unknown', time: 'unknown' } }]) {
      vi.spyOn(api, 'me').mockResolvedValue(answer('admin', everyPage('viewer')));
      vi.spyOn(api, 'health').mockResolvedValue(reply);
      const { unmount } = show();
      await screen.findByRole('link', { name: 'Problems' });
      await Promise.resolve();
      expect(screen.queryByText(/^Build /)).toBeNull();
      unmount();
      vi.restoreAllMocks();
    }
    vi.spyOn(api, 'me').mockResolvedValue(answer('admin', everyPage('viewer')));
    vi.spyOn(api, 'health').mockRejectedValue(new Error('down'));
    show();
    await screen.findByRole('link', { name: 'Problems' });
    expect(screen.queryByText(/^Build /)).toBeNull();
  });

  it('is part of the footer, so the rail, which has no footer, has no build line either', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(answer('admin', everyPage('viewer')));
    vi.spyOn(api, 'health').mockResolvedValue(STAMPED);
    render(
      <MemoryRouter>
        <Sidebar collapsed onToggle={() => undefined} />
      </MemoryRouter>,
    );
    await screen.findAllByRole('link');
    await Promise.resolve();
    expect(screen.queryByText(/^Build /)).toBeNull();
  });
});

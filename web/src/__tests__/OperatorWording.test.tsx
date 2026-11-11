import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { api, login } from '../api';
import { resetAuthProbe } from '../shared/hooks/useAuth';
import { ErrorState } from '../shared/components/states';
import type { Me, Role } from '../types';

/**
 * What operators read must not be written for the person who installed the portal. Setting
 * names, "the BFF" and the name of an API call are for the admin, and everyone else is told who to ask.
 */

const caps = { ai: false, writeBack: false, availabilityMinSeverity: 2, known: true, failed: false, retry: () => undefined };
vi.mock('../features/assistant/useAi', async (original) => ({
  ...(await original<typeof import('../features/assistant/useAi')>()),
  useCapabilities: () => caps,
  useAiEnabled: () => caps.ai,
}));
const sse = { data: [] as unknown[], connected: true, updatedAt: Date.now(), error: null as string | null };
vi.mock('../shared/hooks/useSSE', () => ({ STREAM_SILENT_MS: 45_000, useSSE: () => sse }));
const { default: Assistant } = await import('../features/assistant/Assistant');
const { default: Network } = await import('../features/network/Network');
const { default: Overview } = await import('../features/dashboard/Overview');

const as = (role: Role): Me => ({ authEnabled: true, user: { name: 'x', role }, expiresIn: 3600 });
const signedInAs = (role: Role) => {
  resetAuthProbe();
  vi.spyOn(api, 'me').mockResolvedValue(as(role));
};

/** Words that belong to the person who set the portal up. */
const DEVELOPER_TERMS = /BFF|ZBX_URL|ZABBIX_API_TOKEN|AI_PROVIDER|AI_BASE_URL|ANTHROPIC_API_KEY|NET_GROUP_IDS|server\/\.env|\bSSE\b|map\.get/;

beforeEach(() => {
  caps.ai = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('error hints', () => {
  const zabbixDown = 'Could not reach Zabbix at the configured address.';
  const portalDown = 'Failed to fetch';

  it.each<Role>(['viewer', 'operator'])('tell a %s who to ask, not which setting to change', async (role) => {
    signedInAs(role);
    const { unmount } = render(<ErrorState message={zabbixDown} />);
    expect(await screen.findByText('Cannot reach the monitoring server. Tell the portal admin.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(DEVELOPER_TERMS);
    unmount();

    render(<ErrorState message={portalDown} />);
    expect(await screen.findByText(/The portal is not answering/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/BFF/);
  });

  it('keep the setting names for the admin', async () => {
    signedInAs('admin');
    const { unmount } = render(<ErrorState message={zabbixDown} />);
    expect(await screen.findByText(/ZBX_URL and ZABBIX_API_TOKEN/)).toBeInTheDocument();
    unmount();
    render(<ErrorState message={portalDown} />);
    expect(await screen.findByText('Check that the BFF is running.')).toBeInTheDocument();
  });

  it('say the plain thing until the role is known', async () => {
    resetAuthProbe();
    vi.spyOn(api, 'me').mockImplementation(() => new Promise(() => undefined));
    render(<ErrorState message={zabbixDown} />);
    expect(screen.getByText('Cannot reach the monitoring server. Tell the portal admin.')).toBeInTheDocument();
  });

  it('keep a sign-in failure free of the BFF', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(login('ana', 'pw')).rejects.toThrow(/^Sign-in failed \(HTTP 502\)\. The portal is not answering/);
    await expect(login('ana', 'pw')).rejects.not.toThrow(/BFF/);
  });
});

describe('the Assistant page when no model is set up', () => {
  it.each<Role>(['viewer', 'operator'])('tells a %s to ask, without the setting names', async (role) => {
    signedInAs(role);
    render(<Assistant />);
    expect(await screen.findByText(/The assistant is not set up on this portal/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(DEVELOPER_TERMS);
  });

  it('tells the admin which settings to change', async () => {
    signedInAs('admin');
    render(<Assistant />);
    expect(await screen.findByText(/AI_PROVIDER/)).toBeInTheDocument();
    expect(screen.getByText(/server\/\.env/)).toBeInTheDocument();
  });
});

describe('the Network page with no devices', () => {
  beforeEach(() => void vi.spyOn(api, 'netDevices').mockResolvedValue([]));

  it('asks an operator to ask the admin, without the setting name', async () => {
    signedInAs('operator');
    render(
      <MemoryRouter>
        <Network />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Ask the portal admin which device groups/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(DEVELOPER_TERMS);
  });

  it('names the setting to the admin', async () => {
    signedInAs('admin');
    render(
      <MemoryRouter>
        <Network />
      </MemoryRouter>,
    );
    expect(await screen.findByText('NET_GROUP_IDS')).toBeInTheDocument();
  });
});

describe('the Dashboard live badge', () => {
  it('says Live, not the name of the transport', async () => {
    vi.spyOn(api, 'stats').mockResolvedValue({ hosts: 1, items: 1, triggers: 1, groups: 1, unacknowledged: 0 } as Awaited<ReturnType<typeof api.stats>>);
    vi.spyOn(api, 'problemsByGroup').mockResolvedValue([]);
    vi.spyOn(api, 'problems').mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ wall: false, exitWall: () => undefined }} />}>
            <Route path="/" element={<Overview />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Live', { selector: '.live' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SSE/);
  });
});

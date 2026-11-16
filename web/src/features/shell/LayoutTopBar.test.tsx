import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { resetAuthProbe } from '../../shared/hooks/useAuth';

/** The shell hands the page the measured height of its sticky bar (UX-51), and takes it back when the bar goes, as it does in wall mode. */
vi.mock('../assistant/useAi', () => ({ useCapabilities: () => ({ ai: false, writeBack: false, availabilityMinSeverity: 2 }) }));
const { default: Layout } = await import('./Layout');

let notify: () => void;
let height: number;

beforeEach(() => {
  resetAuthProbe();
  height = 64;
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect);
  vi.spyOn(api, 'me').mockResolvedValue({ authEnabled: false, user: null, expiresIn: null } as never);
});
afterEach(() => {
  document.documentElement.style.removeProperty('--topbar-h');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const value = () => document.documentElement.style.getPropertyValue('--topbar-h');

function show() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>The dashboard</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('the shell and its top bar (UX-51)', () => {
  it('keeps --topbar-h at the height of the bar, also after the bar wraps', () => {
    show();
    expect(value()).toBe('64px');
    height = 112;
    notify();
    expect(value()).toBe('112px');
  });

  it('lets go of it in wall mode, where there is no bar', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Wall mode' }));
    expect(screen.queryByRole('banner')).toBeNull();
    expect(value()).toBe('');
  });
});

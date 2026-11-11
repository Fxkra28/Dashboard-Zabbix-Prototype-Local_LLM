import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The Assistant must not claim "needs a model configured"
 * while it is still asking the server, nor after the server could not be
 * reached: only an answer that says the model is off may say so.
 */

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health },
  chatWarm: vi.fn(async () => undefined),
  chatStream: vi.fn(),
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

const answer = (ai: boolean) => ({ ok: true, ts: 1, ai, writeBack: false, defaults: { availabilityMinSeverity: 2 } });

/** The page fresh, so the shared health probe starts empty. */
async function openPage() {
  vi.resetModules();
  const { default: Assistant } = await import('./Assistant');
  render(<Assistant />);
}

const NOT_CONFIGURED = /needs a model configured|not set up/;

beforeEach(() => {
  health.mockReset(); // a block body: returning the mock would have vitest call it as a teardown
  sessionStorage.clear();
});

describe('the Assistant page before it knows whether a model is configured', () => {
  it('says it is checking, and not that no model is configured', async () => {
    health.mockReturnValue(new Promise(() => undefined)); // never answers
    await openPage();

    expect(screen.getByRole('status')).toHaveTextContent('Checking the assistant…');
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
    expect(screen.queryByLabelText('Question for the assistant')).toBeNull();
  });

  it('says the portal server could not be reached, with a way to try again, after a failed health call', async () => {
    health.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(answer(true));
    const user = userEvent.setup();
    await openPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the portal server.');
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Question for the assistant')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // The call that failed, the retry, and the model check the page makes once it is configured.
    await waitFor(() => expect(health).toHaveBeenCalledTimes(3));
  });

  it('shows the checking state again while a retry is in flight', async () => {
    let answerRetry!: (v: unknown) => void;
    health.mockRejectedValueOnce(new Error('down')).mockReturnValue(new Promise((r) => (answerRetry = r)));
    const user = userEvent.setup();
    await openPage();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking the assistant…');
    expect(screen.queryByRole('alert')).toBeNull();

    answerRetry(answer(false));
    await waitFor(() => expect(screen.getByText(NOT_CONFIGURED)).toBeInTheDocument());
  });
});

describe('the Assistant page once the server has answered', () => {
  it('says a model is needed when the server says none is configured', async () => {
    health.mockResolvedValue(answer(false));
    await openPage();
    expect(await screen.findByText(NOT_CONFIGURED)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers the question box when a model is configured', async () => {
    health.mockResolvedValue(answer(true));
    await openPage();
    expect(await screen.findByLabelText('Question for the assistant')).toBeInTheDocument();
    expect(screen.queryByText(NOT_CONFIGURED)).toBeNull();
  });

  it('shows the conversation the tab kept', async () => {
    sessionStorage.setItem('hcml_chat', JSON.stringify([{ role: 'user', content: 'Which hosts are unreachable?' }]));
    health.mockResolvedValue(answer(true));
    await openPage();
    expect(await screen.findByText('Which hosts are unreachable?')).toBeInTheDocument();
  });
});

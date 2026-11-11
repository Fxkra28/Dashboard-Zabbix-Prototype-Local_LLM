import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { problem } from '../../__tests__/problems';

/**
 * Explain and the Assistant say so when the AI model is not answering. The signal is the
 * `ready.model` a signed-in /api/health carries; only `down` is acted on, and the buttons stay.
 */

const { health, explainProblem } = vi.hoisted(() => ({ health: vi.fn(), explainProblem: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health, explainProblem, explainSla: vi.fn() },
  chatWarm: vi.fn(async () => undefined),
  chatStream: vi.fn(),
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

/** What /api/health says; `model` is the readiness check's answer, left out for a caller who is not signed in. */
const answer = (model?: string) => ({
  ok: true,
  ts: 1,
  ai: true,
  writeBack: false,
  defaults: { availabilityMinSeverity: 2 },
  ...(model ? { ready: { ok: true, zabbix: 'ok', zabbixMs: 12, model, checkedAt: 1 } } : {}),
});

const NOTICE = /The AI model is not answering right now/;

beforeEach(() => {
  health.mockReset();
  explainProblem.mockReset().mockResolvedValue({ summary: 'A link is down.', tagsExplained: [], businessImpact: 'None.', recommendation: 'Check it.' });
  sessionStorage.clear();
});

describe('useModelDown', () => {
  it.each([
    ['down', true],
    ['ok', false],
    ['off', false],
    ['not_checked', false],
    [undefined, false],
  ])('reads ready.model %s as down: %s', async (model, expected) => {
    health.mockResolvedValue(answer(model));
    const { useModelDown } = await import('./useModel');
    const { result } = renderHook(() => useModelDown());
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBe(expected));
  });

  it.each([true, false])('is not down when ready is a plain %s, which is all an anonymous caller gets (IN-47)', async (ready) => {
    health.mockResolvedValue({ ...answer(), ready });
    const { useModelDown } = await import('./useModel');
    const { result } = renderHook(() => useModelDown());
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('is not down when the call fails: no answer is not the same as a model that is not answering', async () => {
    health.mockRejectedValue(new Error('Failed to fetch'));
    const { useModelDown } = await import('./useModel');
    const { result } = renderHook(() => useModelDown());
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('asks again each time it is mounted, because the model can stop or start at any hour', async () => {
    health.mockResolvedValueOnce(answer('ok')).mockResolvedValueOnce(answer('down'));
    const { useModelDown } = await import('./useModel');

    const first = renderHook(() => useModelDown());
    await waitFor(() => expect(health).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBe(false);
    first.unmount();

    const second = renderHook(() => useModelDown());
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(health).toHaveBeenCalledTimes(2);
  });
});

/** The modules fresh, so the shared capabilities probe starts empty. */
async function modules() {
  vi.resetModules();
  const [{ default: Assistant }, { ProblemExplainPanel }] = await Promise.all([import('./Assistant'), import('./ExplainPanel')]);
  return { Assistant, ProblemExplainPanel };
}

describe('the plain-language panel', () => {
  it('says the model is not answering, inside the dialog, when the model is down', async () => {
    health.mockResolvedValue(answer('down'));
    const { ProblemExplainPanel } = await modules();
    render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);

    const note = await screen.findByText(NOTICE);
    expect(note).toHaveAttribute('role', 'status');
    expect(screen.getByRole('dialog')).toContainElement(note);
  });

  it('says nothing when the model answers, and still explains', async () => {
    health.mockResolvedValue(answer('ok'));
    const { ProblemExplainPanel } = await modules();
    render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);

    expect(await screen.findByText('A link is down.')).toBeInTheDocument();
    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('still asks for the explanation when the model is down: the check can lag', async () => {
    health.mockResolvedValue(answer('down'));
    const { ProblemExplainPanel } = await modules();
    render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);

    expect(await screen.findByText('A link is down.')).toBeInTheDocument();
    expect(explainProblem).toHaveBeenCalledTimes(1);
  });
});

describe('the Assistant page', () => {
  it('says the model is not answering when the model is down, and keeps Send working', async () => {
    health.mockResolvedValue(answer('down'));
    const user = userEvent.setup();
    const { Assistant } = await modules();
    render(<Assistant />);

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Question for the assistant'), 'What is down?');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('says nothing when the model answers, for a model that is not checked, or for a caller with no ready block', async () => {
    for (const model of ['ok', 'not_checked', undefined]) {
      health.mockReset().mockResolvedValue(answer(model));
      const { Assistant } = await modules();
      const { unmount } = render(<Assistant />);
      await screen.findByLabelText('Question for the assistant');
      await waitFor(() => expect(health.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(screen.queryByText(NOTICE)).toBeNull();
      unmount();
    }
  });
});

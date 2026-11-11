import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { problem } from '../../__tests__/problems';

/**
 * Under an AI answer the portal says where the question went,
 * but only when the server says it left this machine (the hosted Anthropic API).
 * A local model shows nothing, and so does a server that does not say.
 */

const { health, explainProblem, explainSla } = vi.hoisted(() => ({ health: vi.fn(), explainProblem: vi.fn(), explainSla: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health, explainProblem, explainSla },
  chatWarm: vi.fn(async () => undefined),
  chatStream: vi.fn(),
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

const answer = (over: Record<string, unknown> = {}) => ({
  ok: true,
  ts: 1,
  ai: true,
  writeBack: false,
  defaults: { availabilityMinSeverity: 2 },
  ...over,
});
const HOSTED = answer({ aiProvider: 'anthropic', aiExternal: true });
const LOCAL = answer({ aiProvider: 'openai-compatible', aiExternal: false });

const ASSISTANT_NOTICE = 'Each question, and a summary of the estate, is sent to Anthropic, an external AI service.';
const EXPLAIN_NOTICE = 'To write this, the details shown here were sent to Anthropic, an external AI service.';
const ANY_NOTICE = /external AI service/;

beforeEach(() => {
  health.mockReset();
  explainProblem.mockReset().mockResolvedValue({ summary: 'A link is down.', tagsExplained: [], businessImpact: 'None.', recommendation: 'Check it.' });
  explainSla.mockReset().mockResolvedValue({ status: 'On target', plain: 'Fine.', meetingTarget: true, recommendation: 'Nothing.' });
  sessionStorage.clear();
});

/** The health call has answered and the page has taken the answer in. */
const settled = () => act(async () => void (await Promise.all(health.mock.results.map((r) => r.value))));

/** The modules fresh, so the shared health probe starts empty. */
async function modules() {
  vi.resetModules();
  const [{ default: Assistant }, panels] = await Promise.all([import('./Assistant'), import('./ExplainPanel')]);
  return { Assistant, ...panels };
}

describe('the Assistant page', () => {
  it('names Anthropic under the answers when the hosted API is the model, and keeps its own footer', async () => {
    health.mockResolvedValue(HOSTED);
    const { Assistant } = await modules();
    render(<Assistant />);

    expect(await screen.findByText(ASSISTANT_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/Answers are written by an AI model/)).toBeInTheDocument();
  });

  it('shows nothing about an external service for a local model', async () => {
    health.mockResolvedValue(LOCAL);
    const { Assistant } = await modules();
    render(<Assistant />);

    expect(await screen.findByText(/Answers are written by an AI model/)).toBeInTheDocument();
    await settled();
    expect(screen.queryByText(ANY_NOTICE)).toBeNull();
  });

  it('shows nothing when the server does not say, as an older one does not', async () => {
    health.mockResolvedValue(answer());
    const { Assistant } = await modules();
    render(<Assistant />);

    expect(await screen.findByText(/Answers are written by an AI model/)).toBeInTheDocument();
    await settled();
    expect(screen.queryByText(ANY_NOTICE)).toBeNull();
  });
});

describe('the plain-language panels', () => {
  it('name Anthropic for a problem and for an SLA when the hosted API is the model', async () => {
    health.mockResolvedValue(HOSTED);
    const { ProblemExplainPanel, SlaExplainPanel } = await modules();

    const { unmount } = render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);
    expect(await screen.findByText(EXPLAIN_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/It rephrases, it/)).toBeInTheDocument();
    unmount();

    render(<SlaExplainPanel sla={{ slaid: '1', name: 'Core', slo: '99' }} onClose={() => undefined} />);
    expect(await screen.findByText(EXPLAIN_NOTICE)).toBeInTheDocument();
  });

  it('show nothing about an external service for a local model', async () => {
    health.mockResolvedValue(LOCAL);
    const { ProblemExplainPanel, SlaExplainPanel } = await modules();

    const { unmount } = render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);
    expect(await screen.findByText('A link is down.')).toBeInTheDocument();
    await settled();
    expect(screen.queryByText(ANY_NOTICE)).toBeNull();
    unmount();

    render(<SlaExplainPanel sla={{ slaid: '1', name: 'Core', slo: '99' }} onClose={() => undefined} />);
    expect(await screen.findByText('Fine.')).toBeInTheDocument();
    await settled();
    expect(screen.queryByText(ANY_NOTICE)).toBeNull();
  });

  it('do not name a service the server did not name', async () => {
    health.mockResolvedValue(answer({ aiProvider: 'some-gateway', aiExternal: true }));
    const { ProblemExplainPanel } = await modules();
    render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);

    expect(await screen.findByText('To write this, the details shown here were sent to an external AI service.')).toBeInTheDocument();
    expect(screen.queryByText(/Anthropic/)).toBeNull();
  });
});

describe('useCapabilities', () => {
  /** The hook fresh, so the shared health probe starts empty. */
  async function capabilities() {
    vi.resetModules();
    const { useCapabilities } = await import('./useAi');
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.known).toBe(true));
    return result.current;
  }

  it('carries what the server says about where the AI runs', async () => {
    health.mockResolvedValue(HOSTED);
    expect(await capabilities()).toMatchObject({ aiExternal: true, aiProvider: 'anthropic' });
  });

  it('reads a server that says nothing as "this machine"', async () => {
    health.mockResolvedValue(answer());
    expect(await capabilities()).toMatchObject({ aiExternal: false, aiProvider: null });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { problem } from '../../__tests__/problems';
import { ProblemExplainPanel, SlaExplainPanel } from './ExplainPanel';

/** Both plain-language panels load once, so a failed read says how to try again, and Try again reads again (UX-49). */

const { health, explainProblem, explainSla } = vi.hoisted(() => ({ health: vi.fn(), explainProblem: vi.fn(), explainSla: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health, explainProblem, explainSla },
  chatWarm: vi.fn(async () => undefined),
  chatStream: vi.fn(),
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

beforeEach(() => {
  health.mockReset().mockResolvedValue({ ok: true, ts: 1, ai: true, writeBack: false, defaults: { availabilityMinSeverity: 2 } });
  explainProblem.mockReset();
  explainSla.mockReset();
});

describe('Try again in the Explain panels (UX-49)', () => {
  it('reads the problem again', async () => {
    explainProblem
      .mockRejectedValueOnce(new Error('The model did not answer in time.'))
      .mockResolvedValue({ summary: 'A link is down.', tagsExplained: [], businessImpact: 'None.', recommendation: 'Check it.' });
    render(<ProblemExplainPanel problem={problem(1, 3)} onClose={() => undefined} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The model did not answer in time.');
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('A link is down.')).toBeInTheDocument();
    expect(explainProblem).toHaveBeenCalledTimes(2);
  });

  it('reads the SLA again', async () => {
    explainSla
      .mockRejectedValueOnce(new Error('The model did not answer in time.'))
      .mockResolvedValue({ status: 'On target', plain: 'Fine.', meetingTarget: true, recommendation: 'Nothing.' });
    render(<SlaExplainPanel sla={{ slaid: '1', name: 'Core', slo: '99' }} onClose={() => undefined} />);
    const alert = await screen.findByRole('alert');
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fine.')).toBeInTheDocument();
    expect(explainSla).toHaveBeenCalledTimes(2);
  });
});

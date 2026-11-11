import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SliPill } from './Sli';

describe('SliPill', () => {
  it('says Met or Missed in words, not by colour alone', () => {
    render(<SliPill sli={99.5} target={99} />);
    const met = screen.getByText(/Met/);
    expect(met).toHaveTextContent('99.50% Met');
    expect(met).toHaveClass('up');
  });

  it('never prints a missed figure as the target (FR-07)', () => {
    render(<SliPill sli={98.996} target={99} />);
    const missed = screen.getByText(/Missed/);
    expect(missed).toHaveTextContent('98.996% Missed');
    expect(missed).not.toHaveTextContent('99.00%');
    expect(missed).toHaveClass('down');
  });

  it('adds digits from the place it is asked to show, not from two', () => {
    render(<SliPill sli={98.9996} target={99} digits={3} />);
    expect(screen.getByText(/Missed/)).toHaveTextContent('98.9996% Missed');
  });

  it('keeps the digits the place asks for on a figure that met the target', () => {
    render(<SliPill sli={99.5} target={99} digits={3} />);
    expect(screen.getByText(/Met/)).toHaveTextContent('99.500% Met');
  });

  it('shows no verdict when there is no data', () => {
    render(<SliPill sli={null} target={99} />);
    expect(screen.queryByText(/Met|Missed/)).toBeNull();
  });
});

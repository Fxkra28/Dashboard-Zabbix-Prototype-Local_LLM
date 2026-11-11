import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoData, orNoData } from './NoData';

describe('NoData', () => {
  it('shows a dash to the eye and words to a screen reader', () => {
    const { container } = render(<NoData />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('—');
    expect(screen.getByText('No data')).toHaveClass('sr-only');
  });

  it('takes a narrower label', () => {
    render(<NoData label="None" />);
    expect(screen.getByText('None')).toHaveClass('sr-only');
  });

  it('turns only a bare dash into the placeholder', () => {
    render(<p data-testid="v">{orNoData('—')}</p>);
    expect(screen.getByTestId('v')).toHaveTextContent('—No data');
    render(<p data-testid="n">{orNoData(0)}</p>);
    expect(screen.getByTestId('n')).toHaveTextContent(/^0$/);
  });
});

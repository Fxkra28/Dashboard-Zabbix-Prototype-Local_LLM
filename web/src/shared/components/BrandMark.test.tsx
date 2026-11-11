import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  it('shows the white logo for the chrome, named for a screen reader', () => {
    render(<BrandMark variant="lockup-white" alt="HCML" />);
    const img = screen.getByRole('img', { name: 'HCML' });
    expect(img).toHaveAttribute('src', '/logo-white.png');
    expect(img.parentElement).toHaveClass('brand-mark-lockup-white');
  });

  it('keeps the original logo on its plate, as on the sign-in card', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo.png');
    expect(container.firstChild).toHaveClass('brand-mark-lockup');
  });

  it('falls back to the monogram, still named, when the white logo will not load', () => {
    render(<BrandMark variant="lockup-white" alt="HCML" />);
    fireEvent.error(screen.getByRole('img', { name: 'HCML' }));
    expect(screen.getByRole('img', { name: 'HCML' })).toHaveTextContent('HC');
  });
});

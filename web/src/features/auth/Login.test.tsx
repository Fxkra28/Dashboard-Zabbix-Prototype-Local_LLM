import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const login = vi.fn();
vi.mock('../../api', async (original) => ({ ...(await original<typeof import('../../api')>()), login: (...a: unknown[]) => login(...a) }));
const { default: Login } = await import('./Login');

describe('the sign-in form', () => {
  it('is the one main landmark of the page, with the heading and both fields inside it', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(main).toContainElement(screen.getByRole('heading', { level: 1, name: 'HCML Monitoring Portal' }));
    expect(main).toContainElement(screen.getByLabelText('Username'));
    expect(main).toContainElement(screen.getByLabelText('Password'));
  });

  it('keeps the button focusable while signing in, and sends one sign-in however often it is pressed', async () => {
    let fail!: (e: Error) => void;
    login.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Username'), 'ana');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.click(button);

    // disabled would drop the keyboard focus the button holds (Chrome moves it to <body>).
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(login).toHaveBeenCalledTimes(1);

    fail(new Error('Invalid username or password.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(button).toHaveFocus();
  });
});

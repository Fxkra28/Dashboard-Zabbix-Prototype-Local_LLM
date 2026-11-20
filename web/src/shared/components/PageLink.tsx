import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/** The path of an address inside the portal, without its query or fragment. */
const pathOf = (to: LinkProps['to']): string => (typeof to === 'string' ? to : (to.pathname ?? '')).split(/[?#]/)[0];

/** Whether the account has the page an address opens. A BFF that does not say which pages the account has is taken to allow them, as the rest of the page does. */
export function useCanOpen(to: LinkProps['to']): boolean {
  const { pages } = useAuth();
  return !(pages && !(pathOf(to) in pages));
}

/**
 * A link to another page of the portal, drawn only for an account that has that page. An account with a custom list of pages followed links to pages it was not given and landed on
 * "You do not have access" (UX-78); the sidebar offers no link that can only be refused, and neither should the pages. `fallback` stands where the link would be: by default its words
 * as plain text; a button-like link passes `null`.
 */
export function PageLink({ to, children, fallback, ...rest }: LinkProps & { fallback?: ReactNode }) {
  const open = useCanOpen(to);
  if (!open) return <>{fallback === undefined ? children : fallback}</>;
  return (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
}

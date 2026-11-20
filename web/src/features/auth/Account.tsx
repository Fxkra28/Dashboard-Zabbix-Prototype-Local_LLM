import { useAuth } from '../../shared/hooks/useAuth';
import { count } from '../../shared/lib/plural';
import ChangePassword from './ChangePassword';

/** Who is signed in, what they may do, and the form for their own password, for an account the portal can change. */
export default function Account() {
  const { me, role, pages } = useAuth();
  const name = me?.user?.displayName ?? me?.user?.name;
  // The first administrator is kept in .env, outside the portal's reach: the form would be refused whatever is typed (FR-73).
  const keptInEnv = me?.user?.source === 'env';
  return (
    <div className="grid">
      <section className="panel" aria-labelledby="account-title">
        <h2 id="account-title">{name ?? 'Your account'}</h2>
        {role && (
          <p className="muted">
            Signed in as {me?.user?.name} · role <strong>{role}</strong>
            {pages ? ` · ${count(Object.keys(pages).length, 'page')}` : ''}
          </p>
        )}
      </section>
      {keptInEnv ? (
        <section className="panel" aria-labelledby="account-password">
          <h2 id="account-password">Your password</h2>
          <p>
            This account is kept in the portal’s <code>.env</code> file, so its password is changed there and not on this page. Whoever runs the portal edits the file and restarts it.
          </p>
        </section>
      ) : (
        <ChangePassword />
      )}
    </div>
  );
}

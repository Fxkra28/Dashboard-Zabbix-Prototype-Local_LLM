import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useReportTimeZone } from '../../shared/hooks/useReportTimeZone';
import { Async } from '../../shared/components/states';
import { Field, FieldGroup } from '../../shared/components/Field';
import { TableWrap } from '../../shared/components/TableWrap';
import { serverNow } from '../../shared/lib/clock';
import { formatDateTime, fromZonedInput, toZonedInput } from '../../shared/lib/time';
import type { AccountRequestRecord, Language, ModuleId, ModuleInfo, Role, UserRecord, UsersResponse } from '../../types';
import { LANGUAGE_LABEL, ROLE_LABEL, ROLE_NOTE, effectiveAccess, expiryOf, grantableFor, statusOf } from './access';

/**
 * Users and access: who can sign in, with which role and which pages (ADR-0017). For administrators; the server refuses everyone else. A user is never deleted, only disabled,
 * so the log keeps its names. The pages a user is given are stored for that user: the role's preset only fills in the ticks of a new one.
 */

const ROLES: Role[] = ['guest', 'operator', 'admin'];

/** One tick for each module a user of this role can be given. An administrator has them all, and the ticks say so. */
function ModulePicker({ role, modules, held, onChange, name }: { role: Role; modules: ModuleInfo[]; held: ModuleId[]; onChange: (next: ModuleId[]) => void; name: string }) {
  const admin = role === 'admin';
  const toggle = (id: ModuleId, on: boolean) => onChange(on ? [...held, id] : held.filter((m) => m !== id));
  return (
    <fieldset className="field user-modules">
      <legend className="field-label">Pages</legend>
      {admin && <p className="muted">An administrator has every page.</p>}
      {modules.map((m) => {
        const gone = !admin && m.adminOnly;
        return (
          <label key={m.id} className={`check${admin || gone ? ' disabled' : ''}`}>
            <input type="checkbox" name={`${name}-${m.id}`} checked={admin || (!gone && held.includes(m.id))} disabled={admin || gone} onChange={(e) => toggle(m.id, e.target.checked)} />
            <span>
              {m.label}
              {gone ? ' (administrators only)' : ''}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function RoleSelect({ id, value, onChange }: { id: string; value: Role; onChange: (r: Role) => void }) {
  return (
    <select id={id} name="role" value={value} onChange={(e) => onChange(e.target.value as Role)} aria-describedby={`${id}-note`}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

function LanguageSelect({ id, value, onChange }: { id: string; value: Language | ''; onChange: (l: Language | '') => void }) {
  return (
    <select id={id} name="language" value={value} onChange={(e) => onChange(e.target.value as Language | '')}>
      <option value="">Not chosen</option>
      <option value="en">{LANGUAGE_LABEL.en}</option>
      <option value="id">{LANGUAGE_LABEL.id}</option>
    </select>
  );
}

/** A sign-in name to start from, for a name a stranger typed: lower case, a dot between the words, nothing a name may not hold. The administrator can change it before the account is made. */
export function signInNameFor(typed: string): string {
  const words = typed
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.join('.').slice(0, 64);
}

/** `request`: the account is made for a request that is waiting, from what the person asked for, and approving it takes the request off the list. */
function AddUser({ data, onAdded, request, onSettled }: { data: UsersResponse; onAdded: () => void; request?: AccountRequestRecord; onSettled?: (added?: { name: string; mustChange: boolean }) => void }) {
  const id = useId();
  const zone = useReportTimeZone();
  const heading = useRef<HTMLHeadingElement>(null);
  // The ticks start where the person asked, within what a guest may be given.
  const asked = request ? request.pages.filter((p) => data.modules.some((m) => m.id === p && !m.adminOnly)) : data.presets.guest;
  const [name, setName] = useState(request ? signInNameFor(request.name) : '');
  const [displayName, setDisplayName] = useState(request ? request.name : '');
  const [role, setRole] = useState<Role>('guest');
  const [modules, setModules] = useState<ModuleId[]>(asked);
  useEffect(() => {
    if (request) heading.current?.focus();
  }, [request]);
  const [language, setLanguage] = useState<Language | ''>('');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [expires, setExpires] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [busy, setBusy] = useState(false);

  // A preset is a start: choosing a role ticks the pages that role is meant for, and each tick can still be changed.
  const pick = (next: Role) => {
    setRole(next);
    setModules(data.presets[next]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setAdded('');
    try {
      const body = {
        name: name.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        role,
        modules,
        language: language || null,
        password,
        mustChange,
        expires: expiryOf(expires, (text) => fromZonedInput(text, zone)),
      };
      const { user } = request ? await api.approveRequest(request.id, body) : await api.createUser(body);
      setAdded(user.name);
      setName('');
      setDisplayName('');
      setPassword('');
      setExpires('');
      onAdded();
      onSettled?.({ name: user.name, mustChange: user.mustChange });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The user was not added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
        {request ? `Approve the request of ${request.name}` : 'Add a user'}
      </h2>
      {request && <p className="muted">The account is made as you set it here, with the temporary password you choose and pass on yourself. The request is then taken off the list.</p>}
      <div className="controls">
        <Field label="Sign-in name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} name="name" type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Name shown" htmlFor={`${id}-shown`}>
          <input id={`${id}-shown`} name="displayName" type="text" autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor={`${id}-role`}>
          <RoleSelect id={`${id}-role`} value={role} onChange={pick} />
        </Field>
        <Field label="Language of the Assistant" htmlFor={`${id}-lang`}>
          <LanguageSelect id={`${id}-lang`} value={language} onChange={setLanguage} />
        </Field>
        <Field label="Password" htmlFor={`${id}-pass`}>
          <input id={`${id}-pass`} name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={`Expires after (${zone})`} htmlFor={`${id}-exp`}>
          <input id={`${id}-exp`} name="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <p id={`${id}-role-note`} className="muted">
        {ROLE_NOTE[role]}
      </p>
      <ModulePicker role={role} modules={data.modules} held={modules} onChange={setModules} name="new" />
      <label className="check">
        <input type="checkbox" name="mustChange" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
        <span>The person must choose their own password at the first sign-in</span>
      </label>
      <div className="controls">
        <button className="btn" type="submit" aria-disabled={busy}>
          {busy ? 'Adding…' : request ? 'Approve and add the user' : 'Add user'}
        </button>
        {request && (
          <button className="btn ghost" type="button" onClick={() => onSettled?.()}>
            Leave the request
          </button>
        )}
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      {added && (
        <div className="notice" role="status">
          Added {added}.
        </div>
      )}
    </form>
  );
}

/** A form that opens above the table puts the focus on its heading as it opens, so the keyboard does not stay on a row that has moved down the page. */
function useFocusOnOpen() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return heading;
}

function EditUser({ user, data, onDone }: { user: UserRecord; data: UsersResponse; onDone: () => void }) {
  const id = useId();
  const heading = useFocusOnOpen();
  const zone = useReportTimeZone();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [modules, setModules] = useState<ModuleId[]>(user.modules);
  const [language, setLanguage] = useState<Language | ''>(user.language ?? '');
  const [expires, setExpires] = useState(user.expires === null ? '' : toZonedInput(user.expires, zone).slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const access = effectiveAccess(role, modules, data.modules);

  const pick = (next: Role) => {
    setRole(next);
    // The pages a person may still have under the new role stay ticked; the rest go.
    const allowed = grantableFor(next, data.modules).map((m) => m.id);
    setModules(modules.filter((m) => allowed.includes(m)));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.updateUser(user.name, {
        displayName: displayName.trim() || user.name,
        role,
        modules,
        language: language || null,
        expires: expiryOf(expires, (text) => fromZonedInput(text, zone)),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The user was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={save} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
        Change {user.name}
      </h2>
      <div className="controls">
        <Field label="Name shown" htmlFor={`${id}-shown`}>
          <input id={`${id}-shown`} name="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor={`${id}-role`}>
          <RoleSelect id={`${id}-role`} value={role} onChange={pick} />
        </Field>
        <Field label="Language of the Assistant" htmlFor={`${id}-lang`}>
          <LanguageSelect id={`${id}-lang`} value={language} onChange={setLanguage} />
        </Field>
        <Field label={`Expires after (${zone})`} htmlFor={`${id}-exp`}>
          <input id={`${id}-exp`} name="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <p id={`${id}-role-note`} className="muted">
        {ROLE_NOTE[role]}
      </p>
      <ModulePicker role={role} modules={data.modules} held={modules} onChange={setModules} name="edit" />
      <FieldGroup label="What this account can see and do">
        <p>
          <strong>Pages:</strong> {access.pages.length ? access.pages.join(', ') : 'none'}
        </p>
        <ul>
          {access.can.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </FieldGroup>
      <div className="controls">
        <button className="btn" type="submit" aria-disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

function ResetPassword({ user, onDone }: { user: UserRecord; onDone: () => void }) {
  const id = useId();
  const heading = useFocusOnOpen();
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.resetUserPassword(user.name, password, mustChange);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The password was not set.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={save} noValidate aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
        Set a password for {user.name}
      </h2>
      <Field label="New password" htmlFor={`${id}-pass`}>
        <input id={`${id}-pass`} name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" name="mustChange" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
        <span>The person must choose their own at the next sign-in</span>
      </label>
      <p className="muted">Setting it signs the person out of every session they have open.</p>
      <div className="controls">
        <button className="btn" type="submit" aria-disabled={busy}>
          {busy ? 'Setting…' : 'Set password'}
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

/** The requests for an account that are waiting (FR-62): what the person typed, shown as text, with a way to approve it and a way to refuse it. */
function RequestsPanel({ data, requests, max, onApprove, onChanged }: { data: UsersResponse; requests: AccountRequestRecord[]; max: number; onApprove: (r: AccountRequestRecord) => void; onChanged: () => void }) {
  const [refusing, setRefusing] = useState('');
  const [error, setError] = useState('');
  const label = (page: ModuleId) => data.modules.find((m) => m.id === page)?.label ?? page;
  const refuse = async (r: AccountRequestRecord) => {
    setError('');
    try {
      await api.refuseRequest(r.id);
      setRefusing('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request was not refused.');
    }
  };
  return (
    <section className="panel" aria-labelledby="requests-title">
      <h2 id="requests-title">Requests for an account ({requests.length})</h2>
      <p className="muted">
        People who are not signed in left these. Approving one makes the account with a temporary password you choose; refusing it takes it off the list. A request nobody answers is dropped after 30 days, and at most {max} wait at once.
      </p>
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      {requests.length === 0 ? (
        <p>None waiting.</p>
      ) : (
        <ul className="requests">
          {requests.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> <span className="muted">asked {formatDateTime(r.created * 1000)} for {r.pages.map(label).join(', ')}</span>
              <p className="request-reason">{r.reason}</p>
              {refusing === r.id ? (
                <span role="group" aria-label={`Refuse the request of ${r.name}?`}>
                  <span>Refuse this request? </span>
                  <button type="button" className="btn sm danger" onClick={() => void refuse(r)}>
                    Yes, refuse it
                  </button>{' '}
                  <button type="button" className="btn ghost sm" onClick={() => setRefusing('')}>
                    Keep it
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" className="btn sm" onClick={() => onApprove(r)}>
                    Approve…
                  </button>{' '}
                  <button type="button" className="btn ghost sm" onClick={() => setRefusing(r.id)}>
                    Refuse…
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Open = { user: UserRecord; mode: 'edit' | 'password' } | null;

export default function Users() {
  const q = useAsync<UsersResponse>(() => api.users(), []);
  // Read only while the page can make accounts; a portal where the form is off answers `enabled: false` and the panel is not drawn.
  const requestsQ = useAsync<{ enabled: boolean; max: number; requests: AccountRequestRecord[] }>(() => api.accountRequests(), []);
  const [approving, setApproving] = useState<AccountRequestRecord | null>(null);
  // The account an approval made: the form that made it is gone, so the page says so (the administrator passes on the temporary password).
  const [approved, setApproved] = useState<{ name: string; mustChange: boolean } | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [toggling, setToggling] = useState('');
  const [error, setError] = useState('');
  const now = Math.floor(serverNow() / 1000);
  // The button that opened a form: Save and Cancel take the form and its heading away, which dropped the focus to the page, and a keyboard had to start again from the top (UX-71).
  const opener = useRef<HTMLElement | null>(null);

  const done = () => {
    setOpen(null);
    q.reload();
  };
  const show = (user: UserRecord, mode: 'edit' | 'password') => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen({ user, mode });
  };
  // The form of an approval is taken away when it is done or left, and its buttons with it: the keyboard goes to the heading of the users, as it does when a form of a row closes on a row that has gone.
  const approvingBefore = useRef(false);
  useEffect(() => {
    if (approving !== null) {
      approvingBefore.current = true;
      return;
    }
    if (!approvingBefore.current) return;
    approvingBefore.current = false;
    document.getElementById('users-title')?.focus();
  }, [approving]);
  useEffect(() => {
    if (open !== null || opener.current === null) return;
    const back = opener.current;
    opener.current = null;
    // The row's own button, when it is still there; the heading of the table when the row has gone.
    if (back.isConnected) back.focus();
    else document.getElementById('users-title')?.focus();
  }, [open]);
  const toggle = async (user: UserRecord) => {
    setToggling(user.name);
    setError('');
    try {
      await api.updateUser(user.name, { disabled: !user.disabled });
      q.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The user was not changed.');
    } finally {
      setToggling('');
    }
  };

  return (
    <Async loading={q.loading && !q.data} error={q.error} data={q.data} updatedAt={q.updatedAt} loadingLabel="Reading the users…" onRetry={q.reload}>
      {(data) => (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {!data.editable && (
            <div className="notice" role="note">
              This portal has no data folder to keep users in, so its users are kept in <code>.env</code> and are listed here to read only. Set <code>PORTAL_STATE_DIR</code> to manage users on this page.
            </div>
          )}
          {data.editable && !data.secure && (
            <div className="notice" role="note">
              This connection is not encrypted, so the passwords typed on this page would travel in clear text. Put the portal behind HTTPS before you add real accounts.
            </div>
          )}
          {data.failing && (
            <div className="notice" role="alert">
              The last change could not be saved. Check that the portal’s data folder can be written, then try again.
            </div>
          )}

          {open?.mode === 'edit' && <EditUser key={open.user.name} user={open.user} data={data} onDone={done} />}
          {open?.mode === 'password' && <ResetPassword key={open.user.name} user={open.user} onDone={done} />}
          {approved && (
            <div className="notice" role="status">
              Added {approved.name}. Pass the temporary password on to them yourself{approved.mustChange ? '; they choose their own when they first sign in' : ''}.
            </div>
          )}
          {data.editable && requestsQ.data?.enabled && !approving && (
            <RequestsPanel
              data={data}
              requests={requestsQ.data.requests}
              max={requestsQ.data.max}
              onApprove={(r) => {
                // A form open above the table is closed: the approval is made in the form of a new user, which is hidden while another is open, and its heading cannot take the focus there.
                opener.current = null;
                setOpen(null);
                setApproved(null);
                setApproving(r);
              }}
              onChanged={requestsQ.reload}
            />
          )}
          {/* Hidden while another form is open, and not taken away: a new user half typed is not lost by looking at another row (UX-71). The form of an approval is a fresh one, made for that request. */}
          {data.editable && (
            <div hidden={open !== null}>
              <AddUser
                key={approving?.id ?? 'new'}
                data={data}
                onAdded={() => {
                  q.reload();
                  requestsQ.reload();
                }}
                request={approving ?? undefined}
                onSettled={(added) => {
                  setApproving(null);
                  if (added) setApproved(added);
                }}
              />
            </div>
          )}

          <section className="panel" aria-labelledby="users-title">
            <h2 id="users-title" tabIndex={-1}>
              Users ({data.users.length})
            </h2>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
            <TableWrap label="Users">
              <table className="data compact">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Pages</th>
                    <th>Language</th>
                    <th>Last sign-in</th>
                    <th>Status</th>
                    <th className="sticky-end">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => {
                    const status = statusOf(u, now);
                    const held = effectiveAccess(u.role, u.modules, data.modules).pages;
                    return (
                      <tr key={u.name}>
                        <td>
                          <strong>{u.displayName}</strong>
                          {u.displayName !== u.name && <span className="sli-sub">{u.name}</span>}
                        </td>
                        <td>{ROLE_LABEL[u.role]}</td>
                        <td className="muted" title={held.join(', ')}>
                          {u.role === 'admin' ? 'All' : `${held.length} of ${data.modules.filter((m) => !m.adminOnly).length}`}
                        </td>
                        <td className="muted">{u.language ? LANGUAGE_LABEL[u.language] : '—'}</td>
                        <td className="muted nowrap">{u.lastSignIn ? formatDateTime(u.lastSignIn * 1000) : 'never'}</td>
                        <td>
                          <span className={`pill nowrap ${status.key === 'active' ? 'up' : status.key === 'env' ? 'nodata' : 'down'}`}>{status.label}</span>
                        </td>
                        <td className="nowrap sticky-end">
                          {u.source === 'file' && data.editable && (
                            <>
                              <button type="button" className="btn ghost sm" onClick={() => show(u, 'edit')} aria-label={`Change ${u.name}`}>
                                Change
                              </button>{' '}
                              <button type="button" className="btn ghost sm" onClick={() => show(u, 'password')} aria-label={`Set a password for ${u.name}`}>
                                Password
                              </button>{' '}
                              <button type="button" className="btn ghost sm" aria-disabled={toggling === u.name} onClick={() => toggling !== u.name && void toggle(u)} aria-label={`${u.disabled ? 'Enable' : 'Disable'} ${u.name}`}>
                                {u.disabled ? 'Enable' : 'Disable'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </section>
        </div>
      )}
    </Async>
  );
}

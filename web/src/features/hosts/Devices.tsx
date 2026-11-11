import { useId, useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { roleAllows, useAuth } from '../../shared/hooks/useAuth';
import type { DeviceKind, DevicesResponse } from '../../types';
import { Async } from '../../shared/components/states';
import { Field, FieldGroup, FieldSpacer } from '../../shared/components/Field';
import { HostTable } from './HostTable';
import { count } from '../../shared/lib/plural';
import { tally, trouble, type Tally } from './deviceTally';

/**
 * Devices: every host as a device of one kind (naming.ts, the same kind the SLA report uses), a tile for each kind and the list of the one chosen.
 * Read-only: a device is added in Zabbix.
 */
export default function Devices() {
  const searchId = useId();
  const { role } = useAuth();
  const q = useAsync<DevicesResponse>(() => api.devices(), [], 30_000);
  // The kind, the search and the problems filter live in the URL, so Back and a shared link keep them.
  const [kind, setKind] = useUrlState<string>('type', '');
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 400 });
  const [problemsOnly, setProblemsOnly] = useUrlState<boolean>('problems', false);

  const devices = q.data?.devices;
  const classes = q.data?.classes;
  const known = classes?.some((c) => c.key === kind) ?? false;
  const chosen = known ? (kind as DeviceKind) : '';

  const tallies = useMemo(() => {
    const byKind = new Map<string, Tally>();
    for (const c of classes ?? []) byKind.set(c.key, tally((devices ?? []).filter((d) => d.class === c.key)));
    return { all: tally(devices ?? []), byKind };
  }, [devices, classes]);

  const inKind = useMemo(() => (devices ?? []).filter((d) => !chosen || d.class === chosen), [devices, chosen]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inKind.filter((d) => {
      if (problemsOnly && d.problems.total === 0) return false;
      if (!needle) return true;
      return [d.name, d.site?.name ?? '', d.category].some((text) => text.toLowerCase().includes(needle));
    });
  }, [inKind, search, problemsOnly]);

  const heading = chosen ? (classes?.find((c) => c.key === chosen)?.label ?? chosen) : 'All devices';

  return (
    <>
      <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
        {(data) => (
          <div className="type-tiles" role="group" aria-label="Kind of device">
            <button type="button" className="type-tile" aria-pressed={chosen === ''} onClick={() => setKind('')}>
              {/* The spaces are for the button's name: without them a screen reader says "All devices51 with problems". */}
              <span className="type-name">All devices</span> <span className="type-count">{tallies.all.total}</span>{' '}
              <span className="type-sub">{trouble(tallies.all)}</span>
            </button>
            {data.classes.map((c) => {
              const t = tallies.byKind.get(c.key) ?? { total: 0, withProblems: 0, down: 0 };
              return (
                <button
                  key={c.key}
                  type="button"
                  className="type-tile"
                  aria-pressed={chosen === c.key}
                  disabled={t.total === 0}
                  onClick={() => setKind(c.key)}
                >
                  <span className="type-name">{c.label}</span> <span className="type-count">{t.total}</span>{' '}
                  <span className="type-sub">{t.total === 0 ? 'none' : trouble(t)}</span>
                </button>
              );
            })}
          </div>
        )}
      </Async>

      <div className="controls">
        <Field label="Search device" htmlFor={searchId}>
          <input
            id={searchId}
            name="device-search"
            type="text"
            placeholder="name, site or template…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <FieldGroup label="Filter">
          <label className="filter-check">
            <input
              name="problems-only"
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
            />
            With problems only
          </label>
        </FieldGroup>
        <FieldSpacer>
          {q.data && <span className="pill">{count(filtered.length, 'device')}</span>}
        </FieldSpacer>
      </div>

      <div className="panel">
        <h2>{heading}</h2>
        <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
          {() =>
            filtered.length ? (
              <HostTable
                hosts={filtered}
                showSite
                showCategory
                // Interface data is for a wall screen, an operator and an admin (viewerPolicy.ts), and so is the page of ports.
                portsLink={role !== null && roleAllows(role, 'wall')}
              />
            ) : (
              <div className="state">No device matches.</div>
            )
          }
        </Async>
      </div>
    </>
  );
}

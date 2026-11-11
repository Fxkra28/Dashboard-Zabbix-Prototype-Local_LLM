import { useId, useMemo } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { HostOverview } from '../../types';
import { Async } from '../../shared/components/states';
import { Field, FieldGroup, FieldSpacer } from '../../shared/components/Field';
import { HostTable } from './HostTable';
import { count } from '../../shared/lib/plural';

export default function Hosts() {
  const searchId = useId();
  const q = useAsync<HostOverview[]>(() => api.hostsOverview(), [], 30_000);
  // Both filters live in the URL, so Back from a graph and a shared link keep them.
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 400 });
  const [problemsOnly, setProblemsOnly] = useUrlState<boolean>('problems', false);

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((h) => {
      if (problemsOnly && h.problems.total === 0) return false;
      if (needle && !h.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [q.data, search, problemsOnly]);

  return (
    <>
      <div className="controls">
        <Field label="Search host" htmlFor={searchId}>
          <input
            id={searchId}
            type="text"
            placeholder="host name…"
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
          {q.data && <span className="pill">{count(filtered.length, 'host')}</span>}
        </FieldSpacer>
      </div>

      <div className="panel">
        <Async loading={q.loading} error={q.error} data={q.data} updatedAt={q.updatedAt}>
          {() => (filtered.length ? <HostTable hosts={filtered} /> : <div className="state">No host matches.</div>)}
        </Async>
      </div>
    </>
  );
}

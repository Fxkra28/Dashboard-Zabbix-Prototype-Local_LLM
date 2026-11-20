import { useEffect, useMemo, useRef } from 'react';
import { PageLink } from '../../shared/components/PageLink';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import { useDebounced } from '../../shared/hooks/useDebounced';
import { useUrlState } from '../../shared/hooks/useUrlState';
import type { Host, HostGroup, LatestItem, LatestResponse } from '../../types';
import { Async } from '../../shared/components/states';
import { Field, FieldSpacer } from '../../shared/components/Field';
import { Pager } from '../../shared/components/Pager';
import { fmtValue, fmtTime } from '../../shared/lib/severity';
import { groupBySite } from '../../shared/lib/sites';
import { NoData, orNoData } from '../../shared/components/NoData';
import { TableWrap } from '../../shared/components/TableWrap';

const PAGE_SIZE = 100;

// Monitoring → Latest data: pick a host (or group) and see every item's latest value.
// Search (name or key) and paging happen on the BFF, so a host with thousands
// of items is still one quick page. Host, group, search and page live in the
// URL, so Back from a graph returns to the same page of the same list.
export default function LatestData() {
  const hostsQ = useAsync<Host[]>(() => api.hosts(), []);
  const groupsQ = useAsync<HostGroup[]>(() => api.hostgroups(), []);
  const [hostid, setHostid] = useUrlState<string>('hostid', '');
  const [groupid, setGroupid] = useUrlState<string>('groupid', '');
  const [search, setSearch] = useUrlState<string>('q', '', { debounceMs: 300 });
  const [pageParam, setPage] = useUrlState<number>('page', 1);
  const page = Math.max(1, Math.trunc(pageParam));
  const needle = useDebounced(search.trim(), 300);

  const hostGroups = useMemo(
    () => groupBySite(hostsQ.data ?? [], (h) => h.name, (h) => h.site),
    [hostsQ.data],
  );

  // The first host is chosen once, when the page opens with nothing chosen: choosing "Any" afterwards has to stay.
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !hostGroups.length) return;
    defaulted.current = true;
    if (!hostid && !groupid) setHostid(hostGroups[0].items[0].hostid);
  }, [hostGroups, hostid, groupid, setHostid]);

  // A new search starts at page 1 (a new host or group does, in its onChange).
  // Not on load, which would drop the page the URL asked for.
  const lastNeedle = useRef(needle);
  useEffect(() => {
    if (lastNeedle.current === needle) return;
    lastNeedle.current = needle;
    setPage(1);
  }, [needle, setPage]);

  const q = useAsync<LatestResponse>(
    () =>
      hostid || groupid
        ? api.latest({ hostid, groupid, search: needle, page, pageSize: PAGE_SIZE })
        : Promise.resolve({ items: [], truncated: false, total: 0, page: 1, pageSize: PAGE_SIZE }),
    [hostid, groupid, needle, page],
    20_000,
  );

  // The menus come from two lists of their own. When one cannot load, say so: the table below would
  // otherwise read "No items for this selection" for a reason that has nothing to do with the selection.
  const listsError = (hostsQ.data == null && hostsQ.error) || (groupsQ.data == null && groupsQ.error) || null;
  // With no host or group picked and no menu to pick from, the error is the whole story.
  const noSelectionToShow = listsError !== null && !hostid && !groupid;
  // Only a menu that failed is read again; one that loaded stays as it is (UX-60).
  const retryMenus = () => {
    if (hostsQ.data == null && hostsQ.error) hostsQ.reload();
    if (groupsQ.data == null && groupsQ.error) groupsQ.reload();
  };

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? items.length;
  const pageSize = q.data?.pageSize ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  // A page past the end (an old address, or a list that shrank at the poll) asks for the last page there is.
  useEffect(() => {
    if (q.data && !q.loading && !q.stale && total > 0 && page > pages) setPage(pages);
  }, [q.data, q.loading, q.stale, total, page, pages, setPage]);

  const graphable = (i: LatestItem) => (i.value_type === '0' || i.value_type === '3') && i.state !== '1';
  // A character or text item holds words that look like numbers: a serial, a version, a number in a contact field. Only a number item is formatted as one (FR-69).
  const numeric = (i: LatestItem) => i.value_type === undefined || i.value_type === '0' || i.value_type === '3';
  const shownValue = (i: LatestItem, value: string | undefined) => (numeric(i) ? fmtValue(value, i.units) : value === undefined || value === '' ? '—' : value);

  const noRowsWords =
    total > 0
      ? `There are no items on page ${page}.`
      : !hostid && !groupid
        ? 'Choose a host or a host group to list its items.'
        : needle
          ? `No items match “${needle}”.`
          : 'No items for this selection.';

  return (
    <>
      <div className="controls">
        <Field label="Host" htmlFor="latest-host">
          <select
            id="latest-host"
            value={hostid}
            onChange={(e) => {
              setHostid(e.target.value);
              setGroupid('');
              setPage(1);
            }}
          >
            <option value="">Any</option>
            {hostGroups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.items.map((h) => (
                  <option key={h.hostid} value={h.hostid}>
                    {h.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Host group" htmlFor="latest-group">
          <select
            id="latest-group"
            value={groupid}
            onChange={(e) => {
              setGroupid(e.target.value);
              setHostid('');
              setPage(1);
            }}
          >
            <option value="">Any</option>
            {(groupsQ.data ?? []).map((g) => (
              <option key={g.groupid} value={g.groupid}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search items" htmlFor="latest-search">
          <input
            id="latest-search"
            type="text"
            placeholder="name or key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <FieldSpacer>
          <span className="pill">
            {total ? `${first}–${last} of ${total.toLocaleString()}` : '0 items'}
          </span>
        </FieldSpacer>
      </div>

      {q.data?.truncated && (
        <div className="notice warn">
          More than {total.toLocaleString()} items match, so this list is <strong>incomplete</strong>.
          Narrow the search or pick a single host instead of a group.
        </div>
      )}

      {listsError && !noSelectionToShow && (
        <div className="notice warn" role="alert">
          The host and group menus could not be loaded: {listsError}
          <button type="button" className="btn ghost sm notice-action" onClick={retryMenus}>
            Try again
          </button>
        </div>
      )}

      <div className="panel">
        <Async
          loading={q.loading && !noSelectionToShow}
          error={noSelectionToShow ? listsError : q.error}
          // The items poll and try again by themselves; the menus do not.
          onRetry={noSelectionToShow ? retryMenus : undefined}
          data={noSelectionToShow ? null : q.data}
          stale={q.stale}
          updatedAt={q.updatedAt}
          loadingLabel="Loading latest data…"
          // Outside the content that goes inert while the next page loads, so that the button pressed keeps its focus (UX-57).
          footer={() =>
            (items.length ? pages > 1 : total > 0) && (
              <Pager page={page} pages={pages} onPage={setPage}>
                Page {page} of {pages}
              </Pager>
            )
          }
        >
          {() =>
            items.length ? (
              <>
                <TableWrap label="Latest data">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Key</th>
                        <th>Last check</th>
                        <th>Last value</th>
                        <th>Change</th>
                        <th className="sticky-end"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => {
                        const changed =
                          i.prevvalue !== undefined && i.prevvalue !== i.lastvalue && graphable(i);
                        // Zabbix reports "0" at clock 0 for an item that never collected.
                        const collected = Number(i.lastclock) > 0 && i.lastvalue !== '';
                        return (
                          <tr key={i.itemid}>
                            <td>
                              {i.name}
                              {groupid && i.hosts?.[0] && (
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {i.hosts[0].name}
                                </div>
                              )}
                              {i.state === '1' && (
                                <span className="pill down" style={{ marginLeft: 8 }}>
                                  Not supported
                                </span>
                              )}
                            </td>
                            <td className="muted mono">{i.key_}</td>
                            <td className="muted">{orNoData(fmtTime(i.lastclock))}</td>
                            <td style={{ fontWeight: 500 }}>
                              {collected ? orNoData(shownValue(i, i.lastvalue)) : <NoData />}
                            </td>
                            {/* The dash here says three different things, so a screen reader is told which. */}
                            <td className="muted">
                              {changed ? (
                                `${shownValue(i, i.prevvalue)} →`
                              ) : !collected || i.prevvalue === undefined ? (
                                <NoData />
                              ) : graphable(i) ? (
                                <NoData label="No change" />
                              ) : (
                                <NoData label="Not compared" />
                              )}
                            </td>
                            <td className="sticky-end">
                              {graphable(i) && (
                                <PageLink
                                  className="btn ghost sm"
                                  to={`/graphs?hostid=${i.hosts?.[0]?.hostid ?? hostid}&itemid=${i.itemid}`}
                                  fallback={null}
                                >
                                  Graph
                                </PageLink>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            ) : (
              <div className="state">{noRowsWords}</div>
            )
          }
        </Async>
      </div>
    </>
  );
}

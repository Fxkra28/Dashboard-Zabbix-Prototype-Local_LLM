import { useEffect, useId, useRef, type ReactNode } from 'react';
import { api } from '../../api';
import { useAsync } from '../../shared/hooks/useAsync';
import type { Problem, ProblemExplanation, Sla, SlaExplanation, SliProfile } from '../../types';
import { Async } from '../../shared/components/states';
import { SeverityBadge } from '../../shared/components/StatusBadge';
import { fmtTime } from '../../shared/lib/severity';
import { orNoData } from '../../shared/components/NoData';
import { useDialogFocus } from '../../shared/hooks/useDialogFocus';
import AiDataNotice from './AiDataNotice';
import ModelOfflineNotice from './ModelOfflineNotice';

/**
 * The plain-language layer's UI: a slide-over that translates one Zabbix artifact (a problem's tags
 * and notification wording, or an SLA) for a reader who doesn't speak Zabbix.
 *
 * Nothing here runs until the user clicks "Explain"; the BFF caches each answer, so reopening the
 * same problem costs nothing.
 */

function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);

  // Escape closes, matching how Zabbix's own overlays behave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus in on open, kept inside while open, back to the Explain button on close.
  useDialogFocus(panel);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and the close button do this from the keyboard
    <div className="drawer-overlay" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps the click from reaching the backdrop */}
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {/* A Tab stop of its own: a long explanation scrolls only once the body can take focus. */}
        <div className="drawer-body" tabIndex={0} role="region" aria-labelledby={titleId}>
          <ModelOfflineNotice />
          {children}
        </div>

        <footer className="drawer-foot">
          Written by an AI model from the Zabbix data on this page. It rephrases, it
          doesn’t diagnose.
          Confirm before acting.
          <AiDataNotice kind="explain" />
        </footer>
      </aside>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="explain-section">
      <h3>{label}</h3>
      {children}
    </section>
  );
}

/** Tags + notification wording for one problem. */
export function ProblemExplainPanel({
  problem,
  onClose,
}: {
  problem: Problem;
  onClose: () => void;
}) {
  const q = useAsync<ProblemExplanation>(() => api.explainProblem(problem.eventid), [
    problem.eventid,
  ]);

  return (
    <Drawer
      title="In plain language"
      subtitle={
        <>
          <SeverityBadge level={problem.severity} />
          <span style={{ marginLeft: 8 }}>{problem.name}</span>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            {problem.host || 'Unknown host'} · since {orNoData(fmtTime(problem.clock))}
          </div>
        </>
      }
      onClose={onClose}
    >
      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        stale={q.stale}
        updatedAt={q.updatedAt}
        loadingLabel="Reading the alert…"
      >
        {(x) => (
          <>
            <Section label="What this means">
              <p className="explain-lead">{x.summary}</p>
            </Section>

            <Section label="Who this affects">
              <p>{x.businessImpact}</p>
            </Section>

            <Section label="Suggested next step">
              <p className="explain-action">{x.recommendation}</p>
            </Section>

            {x.tagsExplained.length > 0 && (
              <Section label="What the labels mean">
                <dl className="tag-glossary">
                  {x.tagsExplained.map((t, i) => (
                    <div key={i}>
                      <dt>
                        <span className="tag">
                          {t.tag}
                          {t.value ? `: ${t.value}` : ''}
                        </span>
                      </dt>
                      <dd>{t.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}
          </>
        )}
      </Async>
    </Drawer>
  );
}

/**
 * One SLA's current-period standing. Takes only the fields it renders, so the
 * services tree can open it from a `ServiceSla` without inventing a full `Sla`.
 */
/** One scope of the portal-derived monthly SLA (source=derived on the BFF). */
export interface DerivedSlaScope {
  /** overall | site:N | category:NAME */
  scope: string;
  month?: string;
  profile?: SliProfile;
  /** Shown in the drawer header, e.g. "3 · SSB / Sampang". */
  name: string;
  target: number;
  /** e.g. "Strict" / "HCML report method" */
  methodLabel?: string;
}

export function SlaExplainPanel(
  props:
    | {
        sla: Pick<Sla, 'slaid' | 'name'> & { slo: Sla['slo'] | number };
        serviceid?: string;
        derived?: undefined;
        onClose: () => void;
      }
    | { derived: DerivedSlaScope; sla?: undefined; serviceid?: undefined; onClose: () => void },
) {
  const { sla, serviceid, derived, onClose } = props;
  const q = useAsync<SlaExplanation>(
    () =>
      derived
        ? api.explainSla({
            source: 'derived',
            month: derived.month,
            profile: derived.profile,
            scope: derived.scope,
          })
        : api.explainSla(sla.slaid, serviceid),
    [sla?.slaid, serviceid, derived?.scope, derived?.month, derived?.profile],
  );

  const name = derived ? derived.name : sla.name;
  const target = derived ? derived.target : sla.slo;

  return (
    <Drawer
      title="In plain language"
      subtitle={
        <>
          {name}
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Target {target}% availability
            {derived?.month ? ` · ${derived.month}` : ''}
            {derived?.methodLabel ? ` · ${derived.methodLabel}` : ''}
          </div>
        </>
      }
      onClose={onClose}
    >
      <Async
        loading={q.loading}
        error={q.error}
        data={q.data}
        stale={q.stale}
        updatedAt={q.updatedAt}
        loadingLabel="Reading the SLA…"
      >
        {(x) => (
          <>
            <Section label="Where this stands">
              <p className="explain-lead">
                {x.noData ? (
                  <span className="pill nodata">{x.status || 'No data'}</span>
                ) : (
                  <span className={`pill ${x.meetingTarget ? 'up' : 'down'}`}>{x.status}</span>
                )}
              </p>
              <p>{x.plain}</p>
            </Section>

            <Section label="Suggested next step">
              <p className="explain-action">{x.recommendation}</p>
            </Section>
          </>
        )}
      </Async>
    </Drawer>
  );
}

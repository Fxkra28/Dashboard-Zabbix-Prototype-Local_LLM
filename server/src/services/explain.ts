import { cached } from '../core/cache.js';
import { humanize, type OnUsage, type ProblemExplanation, type SlaExplanation } from '../clients/ai.js';
import type { SliProfile } from '../core/config.js';
import { cachedProblems, SEVERITY_NAMES, withOpdata } from '../domain/queries.js';
import type { SliGroup, SliHost, SliReport } from '../sli/engine.js';
import { snapshotClock } from './assistantSnapshot.js';
import { slasView, sliView } from './sla.js';
import { getMonthlySli } from './sli.js';

/**
 * The plain-language layer. On-demand only: nothing here runs until
 * someone clicks "Explain", and every answer is cached so repeat clicks, and
 * every other NOC screen showing the same problem, are free.
 */

/** An explanation that may say "there is nothing to measure" without a model call. */
export type SlaAnswer = SlaExplanation & { noData?: boolean };

/**
 * With nothing measured, the only honest answer is "no data". Asked to explain
 * an empty SLI list, the model would announce "met its availability target",
 * confidently, and from nothing.
 */
export function noDataExplanation(what: string, why: string, recommendation: string): SlaAnswer {
  return {
    status: 'No data',
    plain: `There is nothing to measure for ${what} yet: ${why}`,
    meetingTarget: false,
    recommendation,
    noData: true,
  };
}

/** A percentage to three decimals: a figure under 100 does not round up to 100, and one under the target does not round up to it (BK-46, BK-56). */
export function pct(n: number, target?: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  const roundsUpTo = (limit: number) => n < limit && rounded >= limit;
  return String(roundsUpTo(100) || (target !== undefined && roundsUpTo(target)) ? Math.floor(n * 1000) / 1000 : rounded);
}

/**
 * The server compares the figure with the target and writes the pill's words; the model only explains. A small model wrote
 * "success" beside a missed target. When its verdict is the other one, its explanation and advice are about a different
 * result, so the server's sentences replace them too.
 */
function agreeWithFigure(answer: SlaExplanation, meeting: boolean, figure: string): SlaExplanation {
  const status = meeting ? 'On target' : 'Below the target';
  if (answer.meetingTarget === meeting) return { ...answer, status };
  return {
    status,
    plain: figure,
    meetingTarget: meeting,
    recommendation: meeting ? 'Nothing to do for this figure.' : 'Start with the devices that have the lowest figures.',
  };
}

/** One scope of a derived report: the whole estate, a site, or a report category. */
export function pickScope(report: SliReport, scope: string): { group: SliGroup; hosts: SliHost[] } | null {
  if (scope === 'overall') return { group: report.overall, hosts: report.hosts };
  if (scope.startsWith('site:')) {
    const group = report.sites.find((s) => s.key === scope);
    if (!group) return null;
    const code = scope.slice('site:'.length);
    const hosts = report.hosts.filter((h) => (h.site ? String(h.site.code) : 'unassigned') === code);
    return { group, hosts };
  }
  if (scope.startsWith('category:')) {
    const name = scope.slice('category:'.length);
    const group = report.categories.find((c) => c.key === name);
    return group ? { group, hosts: report.hosts.filter((h) => h.category === name) } : null;
  }
  return null;
}

export const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60));

export const SLA_PERIODS: Record<string, string> = {
  '0': 'daily',
  '1': 'weekly',
  '2': 'monthly',
  '3': 'quarterly',
  '4': 'annually',
};

/** The thing asked about is not there: the route answers 404 with this wording. */
export interface NotFound {
  notFound: string;
}

/**
 * Tags and notification wording for one problem. The trigger name plus opdata is the notification
 * text as the team receives it; the opdata is read for this problem alone. A given problem's meaning doesn't
 * change, so it is cached for an hour, per acknowledged/resolved state: the explanation says
 * which, and keyed by event alone it would go on saying "not acknowledged" for an hour after
 * someone had.
 */
export async function explainProblem(eventid: string, onUsage: OnUsage): Promise<ProblemExplanation | NotFound> {
  const listed = (await cachedProblems()).find((p) => p.eventid === eventid);
  if (!listed) return { notFound: 'No open problem with that eventid: it may have been resolved.' };

  const acknowledged = listed.acknowledged === '1';
  const resolved = Boolean(listed.r_eventid && listed.r_eventid !== '0');
  const state = `${acknowledged ? 'ack' : 'unack'}:${resolved ? 'resolved' : 'open'}`;
  return cached(`explain:problem:${eventid}:${state}`, 3_600_000, async () => {
    // The list leaves operational data out (queries.ts), so it is read here for this one problem.
    const [problem] = await withOpdata([listed]);
    return humanize(
      'problem',
      {
        host: problem.host,
        notification: problem.name,
        opdata: problem.opdata || null,
        severity: SEVERITY_NAMES[problem.severity] ?? problem.severity,
        started: snapshotClock(new Date(Number(problem.clock) * 1000)),
        acknowledged,
        resolved,
        tags: problem.tags ?? [],
      },
      onUsage,
    );
  });
}

/** The derived monthly SLA of one scope (overall | site:N | category:NAME), in plain language. */
export async function explainDerivedSla(
  { month, profile, scope }: { month: string; profile: SliProfile; scope: string },
  onUsage: OnUsage,
): Promise<SlaAnswer | NotFound> {
  const report = await getMonthlySli(month, profile);
  const picked = pickScope(report, scope);
  if (!picked) return { notFound: `No scope "${scope}" in that report.` };
  const { group, hosts } = picked;

  if (group.sli === null || group.withData === 0) {
    return noDataExplanation(
      `${group.name} in ${month}`,
      'no availability data was collected for these devices in this period.',
      'Check that the devices are reachable from Zabbix and that their ICMP ping items are collecting.',
    );
  }

  // Devices whose ping has never been collected at all (no interface, so
  // the ICMP items are unsupported). HCML's method counts each as 100 %.
  const neverMeasured = hosts.filter((h) => h.measured === false).length;

  // The engine already compared the figure with the target; the model only words it, so a slip near the target cannot show green.
  const meetingTarget = group.meeting === true;
  const figure = `${group.name} was at ${pct(group.sli, report.target)} % in ${month}, against a target of ${pct(report.target)} %.`;
  return cached(`explain:sla:derived:${month}:${profile}:${scope}`, 300_000, async () => ({
    ...agreeWithFigure(await humanize('sla', {
      sla: `${group.name}: monthly availability derived from ICMP ping triggers`,
      slo_target_percent: report.target,
      reporting_period: `calendar month ${month} (${report.timezone})${report.closed ? '' : ', still in progress'}`,
      method:
        profile === 'availability'
          ? 'Strict: a device counts as down while it is unreachable or losing too many pings; hours with no collected data are left out.'
          : "HCML's report method: only high ping loss counts; hours with no collected data count as up.",
      achieved_percent: group.sli,
      devices_measured: group.withData,
      devices_without_data: group.hosts - group.withData,
      devices_below_target: group.belowTarget,
      ...(neverMeasured
        ? {
            devices_never_measured: neverMeasured,
            never_measured_note:
              profile === 'hcml-report'
                ? "These devices have never collected any ping data, yet HCML's method counts each as 100 % available."
                : 'These devices have never collected any ping data, so they are left out of this figure.',
          }
        : {}),
      // The devices that pull the figure down, worst first.
      worst_devices: hosts
        .filter((h) => h.sli !== null)
        .slice(0, 12)
        .map((h) => ({
          device: h.name,
          achieved_percent: h.sli,
          downtime_minutes: minutes(h.downtime),
          error_budget_minutes_left: minutes(h.errorBudget),
        })),
    }, onUsage), meetingTarget, figure),
  }));
}

/** One Zabbix SLA's standing in the current period, in plain language. */
export async function explainZabbixSla(slaid: string, serviceid: string | undefined, onUsage: OnUsage): Promise<SlaAnswer | NotFound> {
  const sla = (await slasView()).find((s) => s.slaid === slaid);
  if (!sla) return { notFound: 'No SLA with that slaid.' };

  const sli = await sliView(slaid, serviceid);

  if (!sli.length) {
    return noDataExplanation(
      `"${sla.name}"`,
      'no services are attached to it in Zabbix, so it has nothing to measure.',
      'Use the derived monthly SLA on the SLA page, or attach services to this SLA in Zabbix.',
    );
  }

  // Met only when every service is at or over the objective; the model words the verdict and does not decide it.
  const meetingTarget = sli.every((s) => s.sli >= Number(sla.slo));
  const figure = `The lowest service is at ${pct(Math.min(...sli.map((s) => s.sli)), Number(sla.slo))} % against a target of ${pct(Number(sla.slo))} %.`;
  // Shorter TTL than problems: the SLI moves as the period progresses.
  return cached(`explain:sla:${slaid}:${serviceid ?? 'all'}`, 300_000, async () => ({
    ...agreeWithFigure(await humanize('sla', {
      sla: sla.name,
      slo_target_percent: Number(sla.slo),
      reporting_period: SLA_PERIODS[sla.period] ?? sla.period,
      services: sli.map((s) => ({
        service: s.name,
        achieved_percent: s.sli,
        uptime_minutes: Math.round(s.uptime / 60),
        downtime_minutes: Math.round(s.downtime / 60),
        error_budget_minutes_left: Math.round(s.error_budget / 60),
      })),
    }, onUsage), meetingTarget, figure),
  }));
}

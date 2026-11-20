/** The calls behind availability and SLA: the availability report, the derived monthly SLA and its files, the service trees and Zabbix's own SLAs. */

import type { ServicesResponse, DerivedServicesResponse, DeletedRecipients, EmailInfo, EmailRequest, EmailSent, SavedRecipients, ReportRange, ReportStyle, ScheduleInfo, ScheduleRequest, SliReport, SliProfile, SlaSource, AvailabilityBasis, Sla, SlaSli, AvailabilityReport } from '../types';
import { availabilityGuard, deletedRecipientsGuard, derivedServicesGuard, emailInfoGuard, emailSentGuard, savedRecipientsGuard, scheduleInfoGuard, servicesGuard, slaListGuard, slaSliGuard, slaSourceGuard, sliGuard } from '../guards';
import { currentSignal, del, fetchOk, post, put, qs, request, SLI_TIMEOUT_MS } from './client';

/** The three file types the monthly SLA report comes in. The CSV files travel as one zip. */
export type ReportFormat = 'pdf' | 'xlsx' | 'csv';

/**
 * The file name a Content-Disposition header proposes, or `fallback` when it
 * names none. `filename*` (UTF-8) wins over `filename`. Only the last path
 * segment is kept, so a header can never aim a download at another folder.
 */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const params = new Map<string, string>();
  // A quoted value is taken whole, so a ";" inside one never starts a parameter.
  const param = /;\s*([\w*-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;
  for (const [, key, raw] of (disposition ?? '').matchAll(param)) {
    const quoted = /^"(.*)"$/s.exec(raw);
    params.set(key.toLowerCase(), quoted ? quoted[1].replace(/\\(.)/g, '$1') : raw.trim());
  }
  let name = params.get('filename') ?? '';
  const encoded = /^utf-8'[^']*'(.*)$/i.exec(params.get('filename*') ?? '');
  if (encoded) {
    try {
      name = decodeURIComponent(encoded[1]);
    } catch {
      // A broken escape: the plain name, if there is one, still stands.
    }
  }
  const clean = (name.replace(/\p{Cc}/gu, '').split(/[\\/]/).pop() ?? '').trim();
  return clean && clean !== '.' && clean !== '..' ? clean : fallback;
}

/**
 * The name to save a report under: the one the BFF sent when it ends in the format's own
 * extension and holds no invisible formatting characters, otherwise one made here. The BFF names
 * the file from the month alone, so this only matters if something between it and the browser
 * answers in its place, and then a name such as `report.pdf.exe` must not survive.
 */
export function reportFileName(disposition: string | null, month: string, format: ReportFormat): string {
  const extension = format === 'csv' ? 'zip' : format;
  const fallback = format === 'csv' ? `HCML_SLA_Report_${month}_csv.zip` : `HCML_SLA_Report_${month}.${format}`;
  const proposed = fileNameFrom(disposition, fallback);
  return proposed.toLowerCase().endsWith(`.${extension}`) && !/\p{Cf}/u.test(proposed) ? proposed : fallback;
}

/** What each format's file is, as the Content-Type header says it. */
const REPORT_TYPES: Record<ReportFormat, { type: string; what: string }> = {
  pdf: { type: 'application/pdf', what: 'a PDF file' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', what: 'an Excel file' },
  csv: { type: 'application/zip', what: 'a zip file' },
};

export interface AvailabilityQuery {
  basis?: AvailabilityBasis;
  profile?: SliProfile;
  /** YYYY-MM calendar month (Asia/Jakarta); takes precedence over `days`. */
  month?: string;
  days?: number;
  /** For the legacy all-problems basis only, which no page of the portal asks for. */
  severity?: number;
}

/** Fetches one report file by the query that names it, and checks that what came back is the file: a 200 is not proof, a proxy that answers a lapsed session with a login page gets there too. */
async function fetchReport(query: string, part: string, format: ReportFormat, signal: AbortSignal | undefined) {
  const res = await fetchOk(`/api/sli/export${query}`, signal ?? currentSignal);
  const { type, what } = REPORT_TYPES[format];
  if (!(res.headers.get('Content-Type') ?? '').toLowerCase().startsWith(type)) {
    throw new Error(`The server answered with something that is not ${what}.`);
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('The server sent an empty file.');
  return { blob, fileName: reportFileName(res.headers.get('Content-Disposition'), part, format) };
}

export const slaApi = {
  // Automated reporting
  availability: (query: AvailabilityQuery) =>
    request<AvailabilityReport>(
      `/api/reports/availability${qs({
        basis: query.basis,
        profile: query.basis === 'all-problems' ? undefined : query.profile,
        month: query.month,
        days: query.month ? undefined : query.days,
        severity: query.basis === 'all-problems' ? query.severity : undefined,
      })}`,
      { guard: availabilityGuard },
    ),
  // Services tree with roll-up status: the service-centric view.
  services: () => request<ServicesResponse>('/api/services', { guard: servicesGuard }),
  /** The tree derived from the estate, for a Zabbix with no services configured. */
  servicesDerived: (month?: string, profile?: SliProfile) =>
    request<DerivedServicesResponse>(`/api/services/derived${qs({ month, profile })}`, { guard: derivedServicesGuard }),
  // Derived monthly SLA (portal-computed from ICMP triggers, read-only)
  sli: (month?: string, profile?: SliProfile) =>
    request<SliReport>(`/api/sli${qs({ month, profile })}`, { timeoutMs: SLI_TIMEOUT_MS, guard: sliGuard }),
  /**
   * The report for a window of whole hours that is not a calendar month, with `dayHours` such as `8-17` and `days` such as `1,2,3,4,5` when only some hours count.
   * It has no web checks, which are monthly.
   */
  sliWindow: (query: { from: number; to: number; profile?: SliProfile; dayHours?: string; days?: string }) =>
    request<SliReport>(`/api/sli${qs({ from: query.from, to: query.to, profile: query.profile, dayHours: query.dayHours, days: query.days })}`, { timeoutMs: SLI_TIMEOUT_MS, guard: sliGuard }),
  /** The month's report as a PDF, Excel or zipped CSV file, named by the BFF; `signal` cancels it. With no `style` the BFF's defaults stand. */
  sliExport: (month: string, format: ReportFormat, signal?: AbortSignal, style?: ReportStyle) =>
    fetchReport(qs({ month, format, decimal: style?.decimal, date: style?.date, separator: format === 'csv' ? style?.separator : undefined }), month, format, signal),
  /** The same file for a range of days and the hours of the day that count (FR-60): one figure for the whole range, and no web checks, which are monthly. */
  sliRangeExport: (range: ReportRange, format: ReportFormat, signal?: AbortSignal, style?: ReportStyle) =>
    fetchReport(
      qs({ from: range.from, to: range.to, dayHours: range.dayHours, days: range.days, format, decimal: style?.decimal, date: style?.date, separator: format === 'csv' ? style?.separator : undefined }),
      `${range.from}_to_${range.to}`,
      format,
      signal,
    ),
  /** Whether the report can be emailed, and from and to whom. Administrators only: the BFF refuses the others. */
  sliEmailInfo: () => request<EmailInfo>('/api/sli/email', { guard: emailInfoGuard }),
  /** Emails the month's report, in the formats and to the addresses asked for. The BFF's own sentence is the error when it fails. */
  // The server builds the month's report before it sends: as long as a download may take, so a second send is not a second email.
  sliEmail: (month: string, options: EmailRequest) => post<EmailSent>('/api/sli/email', { month, ...options }, emailSentGuard, SLI_TIMEOUT_MS),
  /** Emails the report for a range of days (FR-60). The window is an object because `to`, in the options, is the list of people. */
  sliRangeEmail: (range: ReportRange, options: EmailRequest) =>
    post<EmailSent>('/api/sli/email', { window: { from: range.from, to: range.to }, dayHours: range.dayHours, days: range.days, ...options }, emailSentGuard, SLI_TIMEOUT_MS),
  /** The monthly send: how it is set, when it goes next and what was sent. Administrators only. */
  sliSchedule: () => request<ScheduleInfo>('/api/sli/schedule', { guard: scheduleInfoGuard }),
  /** Sets the monthly send and the saved recipients. The answer is what `sliSchedule` would say now. */
  sliScheduleSave: (settings: ScheduleRequest) => put<ScheduleInfo>('/api/sli/schedule', settings, scheduleInfoGuard),
  /** Replaces the saved list of recipients. The answer is the list that applies now. Administrators only. */
  sliRecipientsSave: (recipients: string[]) => put<SavedRecipients>('/api/sli/recipients', { recipients }, savedRecipientsGuard),
  /** Deletes the saved list. The list in MAIL_TO, if there is one, applies again. Administrators only. */
  sliRecipientsDelete: () => del<DeletedRecipients>('/api/sli/recipients', deletedRecipientsGuard),
  // Services → SLA
  slaSource: () => request<SlaSource>('/api/sla/source', { guard: slaSourceGuard }),
  sla: () => request<Sla[]>('/api/sla', { guard: slaListGuard }),
  slaSli: (slaid: string, serviceid?: string) =>
    request<SlaSli[]>(`/api/sla/sli${qs({ slaid, serviceid })}`, { guard: slaSliGuard }),
};

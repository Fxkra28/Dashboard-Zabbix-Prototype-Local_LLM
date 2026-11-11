/** Availability and SLA: the availability report, the derived monthly SLA, the service trees and Zabbix's own SLAs. */

import type { SiteRef } from './hosts';

export interface HostAvailability {
  hostid: string;
  host: string;
  /** Percent; null = too little collected data to say (availability basis). */
  availability: number | null;
  downtime: number;
  incidents: number;
  longest: number;
  coverage?: number;
  dataStatus?: DataStatus;
  category?: string;
  site?: SiteRef | null;
}

export type AvailabilityBasis = 'availability' | 'all-problems';

export interface AvailabilityReport {
  from: number;
  to: number;
  windowSeconds: number;
  minSeverity: number;
  hosts: HostAvailability[];
  truncated: boolean;
  basis?: AvailabilityBasis;
  profile?: SliProfile;
  month?: string | null;
  target?: number;
  overall?: SliGroup;
  categories?: SliGroup[];
  sites?: SliGroup[];
  gaps?: SliGap[];
  /** Spans the portal's setting SLA_NO_DATA_WINDOWS declares not measured; no downtime is counted in them. */
  noDataWindows?: SliGap[];
}

// Derived monthly SLA (/api/sli, server sli/engine.ts)

/** `availability` = strict (unreachable counts, gaps excluded); `hcml-report` = HCML's published method. */
export type SliProfile = 'availability' | 'hcml-report';

export type DataStatus = 'ok' | 'partial' | 'nodata';

export interface SliGap {
  from: number;
  to: number;
}

export interface SliHost {
  hostid: string;
  name: string;
  hostStatus: string;
  site: SiteRef | null;
  category: string;
  deviceClass: string;
  triggerids: string[];
  sli: number | null;
  downtime: number;
  window: number;
  covered: number;
  /** Seconds inside planned maintenance, left out of the figure. */
  maintenance: number;
  coverage: number;
  incidents: number;
  longest: number;
  dataStatus: DataStatus;
  /** False when the host's ICMP never collected; HCML's method still counts it as 100 %. */
  measured?: boolean;
  meeting: boolean | null;
  errorBudget: number | null;
}

export interface SliGroup {
  key: string;
  name: string;
  hosts: number;
  withData: number;
  sli: number | null;
  downtime: number;
  meeting: boolean | null;
  belowTarget: number;
}

export interface SliPath {
  key: string;
  name: string;
  site: SiteRef | null;
  legs: { hostid: string; name: string; leg: string; sli: number | null; dataStatus: DataStatus }[];
  sli: number | null;
  downtime: number;
  coverage: number;
  dataStatus: DataStatus;
}

export interface SliWeb {
  itemid: string;
  name: string;
  sli: number | null;
  downtime: number;
  coverage: number;
  dataStatus: DataStatus;
}

export interface SliReport {
  source: 'derived';
  label: string;
  profile: SliProfile;
  month: string | null;
  from: number;
  to: number;
  end: number;
  closed: boolean;
  timezone: string;
  target: number;
  basis: {
    triggers: string[];
    gapPolicy: 'counted-as-up' | 'excluded';
    noDataPolicy: 'counted-as-100' | 'excluded';
    maintenancePolicy: 'excluded';
  };
  overall: SliGroup;
  categories: SliGroup[];
  sites: SliGroup[];
  classes: SliGroup[];
  hosts: SliHost[];
  wanPaths: SliPath[];
  web: SliWeb[];
  gaps: SliGap[];
  /** Spans declared not measured (SLA_NO_DATA_WINDOWS), treated as hours with no data by both methods. */
  noDataWindows: SliGap[];
  stats: { zabbixCalls: number; triggers: number; events: number; trendRows: number; ms: number };
  generatedAt: number;
}

// Services tree (Zabbix Services, read-only)
export interface ServiceSla {
  slaid: string;
  name: string;
  slo: number;
  sli: number;
  /** Seconds of downtime the period can still absorb; negative = SLO missed. */
  errorBudget: number;
  meeting: boolean;
}

export interface ServiceNode {
  serviceid: string;
  name: string;
  /** -1 = OK, otherwise the Zabbix severity that propagated up. */
  status: number;
  algorithm: string;
  description?: string;
  tags: { tag: string; value: string }[];
  /** The problems Zabbix blames for this service's state. */
  problems: { eventid: string; name: string; severity: string }[];
  sla?: ServiceSla;
  children: ServiceNode[];
  worst: number;
  descendants: number;
}

export interface ServicesResponse {
  tree: ServiceNode[];
  total: number;
  degraded: number;
  worst: number;
}

/** Services derived from the estate (server sli/tree.ts) when Zabbix has none. */
export type DerivedKind = 'root' | 'business' | 'site' | 'class' | 'wan-path' | 'host' | 'web';

export interface DerivedServiceNode extends ServiceNode {
  kind: DerivedKind;
  hostid?: string;
  dataStatus: DataStatus;
  coverage: number | null;
  children: DerivedServiceNode[];
}

export interface DerivedServicesResponse extends ServicesResponse {
  tree: DerivedServiceNode[];
  source: 'derived';
  label: string;
  month: string;
  profile: SliProfile;
  target: number;
  closed: boolean;
  gaps: SliGap[];
  noDataWindows: SliGap[];
}

/** Whether Zabbix's own SLAs have anything to show (/api/sla/source). */
export interface SlaSource {
  real: boolean;
  slas: number;
  services: number;
}

/** How a report writes its numbers and dates, and what a CSV file puts between its fields. Never changes a figure. */
export interface ReportStyle {
  decimal: 'dot' | 'comma';
  date: 'long' | 'numeric' | 'iso';
  separator: 'comma' | 'semicolon';
}

/** The kinds of file the report comes in. The CSV files travel as one zip. */
export type ReportFileFormat = 'pdf' | 'xlsx' | 'csv';

/** GET /api/sli/email: whether the report can be emailed, from where, to whom unless told otherwise, and how far a list may go (administrators only). */
export interface EmailInfo {
  enabled: boolean;
  from: string;
  /** The saved list. */
  recipients: string[];
  /** The most addresses a list may hold. */
  max: number;
  /** Lower case. Empty: an address may be in any domain. */
  allowedDomains: string[];
  /** Whether the saved list survives a restart of the portal. */
  kept: boolean;
}

/** PUT /api/sli/recipients: the list the portal saved, and the list that applies now. */
export interface SavedRecipients {
  recipients: string[];
  saved: number;
}

/** DELETE /api/sli/recipients: the list that applies now (the one in MAIL_TO, or nobody), and how many addresses were removed. */
export interface DeletedRecipients {
  recipients: string[];
  removed: number;
}

/** What POST /api/sli/email takes besides the month. */
export interface EmailRequest {
  formats: ReportFileFormat[];
  to?: string[];
  remember?: boolean;
  style?: ReportStyle;
}

/** POST /api/sli/email: how many recipients the mail server took the message for, how many it refused, and what went. */
export interface EmailSent {
  sent: number;
  refused: number;
  month: string;
  files: { format: ReportFileFormat; fileName: string; bytes: number }[];
  /** Whether the list was saved. */
  remembered: boolean;
}

/** The monthly send as it is set. */
export interface ScheduleSettings {
  enabled: boolean;
  /** 1 to 28. */
  day: number;
  /** HH:MM, 24 hours, in the report time zone. */
  time: string;
  formats: ReportFileFormat[];
  style: ReportStyle;
  /** Who is told when a send fails. */
  notify: string[];
  setBy: string;
  /** Unix seconds. */
  setAt: number;
}

/** One send the portal made, with counts and never an address. */
export interface SendRecord {
  month: string;
  trigger: 'schedule' | 'manual';
  /** A user name, or "schedule". */
  by: string;
  /** Unix seconds. */
  at: number;
  outcome: 'sending' | 'sent' | 'failed' | 'missed';
  attempts: number;
  formats: ReportFileFormat[];
  recipients: number;
  refused: number;
  bytes: number;
  reason?: string;
}

/** GET and PUT /api/sli/schedule (administrators only). */
export interface ScheduleInfo {
  available: boolean;
  /** Empty when available; otherwise a sentence that says what to change. */
  why: string;
  timezone: string;
  /** Null until one is saved. */
  schedule: ScheduleSettings | null;
  recipients: string[];
  /** The next send: the month it is for and when (Unix seconds); `retrying` when a send failed and waits for another try. */
  next: { month: string; at: number; retrying: boolean } | null;
  /** The last twelve, newest first. */
  sends: SendRecord[];
  max: number;
  maxNotify: number;
  allowedDomains: string[];
}

/** What PUT /api/sli/schedule takes. */
export interface ScheduleRequest {
  enabled: boolean;
  day: number;
  time: string;
  formats: ReportFileFormat[];
  recipients: string[];
  notify: string[];
  style?: ReportStyle;
}

// Services → SLA (Zabbix-native, read-only)
export interface Sla {
  slaid: string;
  name: string;
  slo: string; // promised availability target, e.g. '99.9'
  period: string; // '0' daily … '4' annually
  status: string; // '0' disabled, '1' enabled
  timezone?: string;
  description?: string;
}

export interface SlaSli {
  serviceid: string;
  name: string;
  sli: number; // achieved availability %
  uptime: number; // seconds
  downtime: number; // seconds
  error_budget: number; // seconds left before the SLO is missed (negative = missed)
  period_from: number;
  period_to: number;
}

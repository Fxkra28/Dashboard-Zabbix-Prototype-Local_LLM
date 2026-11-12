/**
 * What the slow reports (availability, noise and capacity) share: how long an answer is kept, that an old one may be served while a
 * refresh runs or fails, and how many of them may read Zabbix at once. Automated reporting (HCML Goal 6): "hard to see SLA, capacity
 * trends, and recurring issues".
 */

import { createGate } from '../core/gate.js';

/** Cache lifetimes of the slow reports below. */
export const REPORT_TTL = 120_000;

/** A run of the Capacity report took HCML's Zabbix 256 s, and it covers days, so a run is kept an hour. */
export const CAPACITY_TTL = 60 * 60_000;

/** Past that hour the previous run is shown, with its age, for up to a day while the next one is built. */
export const CAPACITY_STALE_MS = 23 * 60 * 60_000;

/**
 * Past its TTL a slow report is answered at once from the previous run, with
 * its age, for as long again while one refresh runs, and a failed refresh
 * answers with that run too (cache.ts). Only for reports over days of history,
 * never for `aging` or anything else showing live problem state.
 */
export const staleReport = (ttlMs: number) => ({ staleMs: ttlMs, staleIfError: true, noteAge: true });

/**
 * How many reports over days of history are read from Zabbix at once: a cold `noise` report over 365 days takes 7 s and thousands of SQL statements,
 * and every new `days` or `severity` is a cold one, so the others wait their turn. A cached answer never waits.
 */
export const HEAVY_REPORTS_AT_ONCE = 2;

export const heavy = createGate(HEAVY_REPORTS_AT_ONCE);

/** A cold month of the derived SLA is about 19 trend reads of 35 items, and a viewer can ask for every month in both profiles at once (BK-50). */
export const SLI_AT_ONCE = 2;
export const sliReads = createGate(SLI_AT_ONCE);

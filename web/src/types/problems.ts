/** Open problems, and the answer of the portal's one write. */

export interface Problem {
  eventid: string;
  objectid: string;
  object: string;
  name: string;
  severity: string; // '0'..'5'
  clock: string;
  r_eventid?: string; // '0' when still open
  r_clock?: string;
  acknowledged: string; // '0' | '1'
  suppressed?: string;
  opdata?: string;
  tags?: { tag: string; value: string }[];
  host?: string;
  hostid?: string;
  /** Whether the trigger permits manual close, gates the Close option (§20). */
  manualClose?: boolean;
}

/** POST /api/problems/acknowledge: the answer of the portal's one write. */
export interface AcknowledgeResult {
  ok: true;
  eventids: string[];
  /** The Zabbix action bitmask that was applied. */
  action: number;
}

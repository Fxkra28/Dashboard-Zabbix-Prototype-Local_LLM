/** Whether a problem has been acknowledged, from Zabbix's '0' or '1'. */
export function AckPill({ acknowledged }: { acknowledged: string }) {
  return acknowledged === '1' ? <span className="pill up">Yes</span> : <span className="pill">No</span>;
}

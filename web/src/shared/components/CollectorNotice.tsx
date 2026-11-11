import type { Freshness } from '../../types';
import { momentWords } from '../lib/freshness';

/** Zabbix still answers but almost no device answers its ping: its way into the network is cut, not every device. */
export const reachLost = (f: Freshness | null | undefined) => Boolean(f && !f.stale && f.reachLost);

/**
 * Says when the page does not show the network as it is now: Zabbix has collected nothing for a while,
 * or it is cut off from the network and the down hosts and problems it raises are not real.
 */
export function CollectorNotice({ freshness, now = Date.now() }: { freshness: Freshness | null | undefined; now?: number }) {
  if (freshness?.stale && freshness.lastCollectedAt !== null) {
    // Stable wording: it is announced on a change, and a running count would be read out every minute.
    return (
      <div className="refresh-failed" role="status">
        Zabbix has collected nothing since {momentWords(freshness.lastCollectedAt * 1000, now)}. What you see on this page
        is from then, not from now.
      </div>
    );
  }
  if (!freshness || !reachLost(freshness)) return null;
  return (
    <div className="refresh-failed">
      <span role="status">
        Zabbix cannot reach the network: almost no device answers its ping, so the hosts it calls down and the
        problems it raises now are most likely not real.
      </span>{' '}
      <span>
        {freshness.answering} of {freshness.pinged} answered.
      </span>
    </div>
  );
}

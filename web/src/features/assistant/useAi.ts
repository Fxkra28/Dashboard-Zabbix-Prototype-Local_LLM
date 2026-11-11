import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { setReportTimeZone } from '../../shared/lib/time';

/**
 * Which optional BFF capabilities are configured?
 *
 * One /api/health probe shared by every page. Pages hide actions that aren't
 * available: an "Explain" button with no API key, or an "Ack" button with no
 * write token, rather than offering something that can only fail.
 */
interface Capabilities {
  ai: boolean;
  /** Questions to the AI leave this machine: the hosted API does, a local model does not. */
  aiExternal: boolean;
  /** Which backend answers, as the server names it; null until it has said. */
  aiProvider: string | null;
  writeBack: boolean;
  /**
   * Severity floor the availability report uses when none is chosen. Comes
   * from the server so the two cannot disagree: the right value is
   * site-specific (HCML's estate alarms at 2, not 3) and belongs in one place.
   */
  availabilityMinSeverity: number;
  /** The server has answered. Before that `ai` and `writeBack` read false only because nothing is known. */
  known: boolean;
  /** The last health call got no answer: the BFF is down or restarting. */
  failed: boolean;
}

const UNKNOWN: Capabilities = {
  ai: false,
  aiExternal: false,
  aiProvider: null,
  writeBack: false,
  availabilityMinSeverity: 2,
  known: false,
  failed: false,
};
const FAILED: Capabilities = { ...UNKNOWN, failed: true };

let probe: Promise<Capabilities> | null = null;
/** The last answer the server gave, so a page opened later starts from it rather than from "checking". */
let answered: Capabilities | null = null;

/** Ask /api/health once and share the answer; also where the server's time zone is taken (main.tsx starts this). */
export function loadCapabilities(): Promise<Capabilities> {
  probe ??= api
    .health()
    .then((h) => {
      setReportTimeZone(h.defaults?.timezone);
      return (answered = {
        ai: Boolean(h.ai),
        // An older BFF sends neither field, which reads as "stays on this machine".
        aiExternal: Boolean(h.aiExternal),
        aiProvider: h.aiProvider ?? null,
        writeBack: Boolean(h.writeBack),
        availabilityMinSeverity: h.defaults?.availabilityMinSeverity ?? UNKNOWN.availabilityMinSeverity,
        known: true,
        failed: false,
      });
    })
    // Don't remember a failure: one health check during a BFF restart would
    // hide Explain and Acknowledge for the rest of the session.
    .catch(() => {
      probe = null;
      return FAILED;
    });
  return probe;
}

export function useCapabilities(): Capabilities & { retry: () => void } {
  const [caps, setCaps] = useState<Capabilities>(() => answered ?? UNKNOWN);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadCapabilities().then((v) => {
      if (alive) setCaps(v);
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  /** Ask again after a failure, showing "checking" meanwhile. */
  const retry = useCallback(() => {
    setCaps(UNKNOWN);
    setAttempt((n) => n + 1);
  }, []);

  return useMemo(() => ({ ...caps, retry }), [caps, retry]);
}

/** Convenience for the pages that only care about the plain-language layer. */
export function useAiEnabled(): boolean {
  return useCapabilities().ai;
}

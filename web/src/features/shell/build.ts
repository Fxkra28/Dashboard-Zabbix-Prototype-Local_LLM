import { formatDateTime } from '../../shared/lib/time';

/** The build the BFF is running, from a signed-in /api/health. */
export interface Build {
  /** A short commit, "uncommitted" when it was built from a working tree, or "unknown" when the build was not stamped. */
  commit: string;
  /** When it was built, as the ISO time the image was stamped with, or "unknown". */
  time: string;
}

/**
 * The line the sidebar shows under its footer: `Build abc1234, 07/10/2026, 16.19.57 WIB`. Null when
 * the build was not stamped at all, since a line that says only "unknown" helps nobody. The time is
 * written in the report zone, like every other time in the portal, so it is not read as the viewer's clock.
 */
export function buildLabel(build: Build | null): string | null {
  if (!build) return null;
  const commit = build.commit.trim();
  const at = Date.parse(build.time);
  const known = commit !== '' && commit !== 'unknown';
  if (!known && Number.isNaN(at)) return null;
  const parts = [known ? commit : null, Number.isNaN(at) ? null : formatDateTime(at)].filter(Boolean);
  return `Build ${parts.join(', ')}`;
}

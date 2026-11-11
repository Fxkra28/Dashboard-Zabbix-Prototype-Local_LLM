import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSearchPatch } from '../../shared/hooks/useUrlState';

/**
 * The Dashboard's wall mode (DESIGN.md section 9): no sidebar or top
 * bar, larger type, a clock and a "data as of" stamp. It lives in the URL as
 * ?wall=1, so a kiosk browser can open straight into it. The button also asks
 * for the browser's fullscreen, which only a click may do and which a kiosk
 * browser already is.
 */
export function useWallMode(): { wall: boolean; enter: () => void; exit: () => void } {
  const { pathname, search } = useLocation();
  const patch = useSearchPatch();
  const wall = pathname === '/' && new URLSearchParams(search).get('wall') === '1';
  // Whether the browser's fullscreen is ours: ours to undo, and ours to follow when Esc ends it.
  const ownsFullscreen = useRef(false);

  const enter = useCallback(() => {
    patch({ wall: '1' });
    // Refused (an iframe, a browser policy): the wall layout works without it.
    document.documentElement.requestFullscreen?.().then(
      () => {
        ownsFullscreen.current = true;
      },
      () => undefined,
    );
  }, [patch]);

  const exit = useCallback(() => {
    patch({ wall: null });
    if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    ownsFullscreen.current = false;
  }, [patch]);

  // Leaving by a link or Back ends the wall layout without exit(): the
  // fullscreen it asked for ends with it.
  useEffect(() => {
    if (wall || !ownsFullscreen.current) return;
    ownsFullscreen.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [wall]);

  // Esc ends the browser's fullscreen without asking the page; the wall layout ends with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && ownsFullscreen.current) exit();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [exit]);

  return { wall, enter, exit };
}

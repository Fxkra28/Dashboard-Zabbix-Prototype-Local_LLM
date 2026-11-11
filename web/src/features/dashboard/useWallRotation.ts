import { useEffect, useState } from 'react';
import { slideKey, type Slide } from '../../shared/lib/wall';

/**
 * Turns through the slides, `seconds` on each; stands still with one slide, 0 seconds, or while `paused`.
 * A different set of slides starts at the first; the caller keeps the slides stable between renders.
 */
export function useWallRotation(slides: Slide[], seconds: number, paused: boolean) {
  const key = slides.map(slideKey).join(',');
  const [at, setAt] = useState({ key, index: 0 });
  // A different set of slides starts over, in the render that sees it, so nothing flashes the wrong one.
  const index = at.key === key ? at.index : 0;
  const running = slides.length > 1 && seconds > 0 && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setAt((was) => ({ key, index: ((was.key === key ? was.index : 0) + 1) % slides.length })), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [running, seconds, key, slides.length]);

  return { slide: slides[Math.min(index, slides.length - 1)], running };
}

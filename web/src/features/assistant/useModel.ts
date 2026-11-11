import { useEffect, useState } from 'react';
import { api } from '../../api';

/**
 * Whether the AI model is known not to answer, from the `ready.model` a signed-in /api/health
 * carries (the BFF checks it at most every 15 s). Asked when the Explain panel or the Assistant
 * opens rather than once per session: the shared capabilities call runs before sign-in and never
 * holds it, and a model can stop or start at any hour. Only `down` counts. `ok`, `off`,
 * `not_checked` (the hosted model, which a probe would bill), a plain boolean (all an anonymous
 * caller gets), a BFF that predates the field and a failed call all read as "no notice".
 */
export function useModelDown(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => {
        if (alive) setDown(typeof h.ready === 'object' && h.ready?.model === 'down');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return down;
}

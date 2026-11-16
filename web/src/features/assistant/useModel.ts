import { useEffect, useState } from 'react';
import { api } from '../../api';

/** What is wrong with the AI model, when the BFF knows: it does not answer, or the model server does not have the model installed (BK-66). */
export type ModelProblem = 'down' | 'missing';

/**
 * What is known to be wrong with the AI model, from the `ready.model` a signed-in /api/health
 * carries (the BFF checks it at most every 15 s). Asked when the Explain panel or the Assistant
 * opens rather than once per session: the shared capabilities call runs before sign-in and never
 * holds it, and a model can stop or start at any hour. Only `down` and `missing` count. `ok`, `off`,
 * `not_checked` (the hosted model, which a probe would bill), a plain boolean (all an anonymous
 * caller gets), a BFF that predates the field and a failed call all read as "no notice".
 */
export function useModelProblem(): ModelProblem | null {
  const [problem, setProblem] = useState<ModelProblem | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => {
        const model = typeof h.ready === 'object' ? h.ready?.model : undefined;
        if (alive) setProblem(model === 'down' || model === 'missing' ? model : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return problem;
}

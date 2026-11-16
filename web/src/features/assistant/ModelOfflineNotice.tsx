import { useModelProblem } from './useModel';

/**
 * Says so when the AI model is not answering, or is not installed on the model server, before a click that would only fail.
 * The buttons stay: the BFF's check is cached, so it can lag a model that has just come back.
 */
export default function ModelOfflineNotice() {
  const problem = useModelProblem();
  if (!problem) return null;
  return (
    <div className="refresh-failed" role="status">
      {problem === 'missing'
        ? 'The AI model is not installed on the model server, so every request fails until an administrator installs it. The rest of the portal is not affected.'
        : 'The AI model is not answering right now, so a request may fail. The rest of the portal is not affected.'}
    </div>
  );
}

import { useModelDown } from './useModel';

/**
 * Says so when the AI model is not answering, before a click that would only fail. The buttons
 * stay: the BFF's check is cached, so it can lag a model that has just come back.
 */
export default function ModelOfflineNotice() {
  const down = useModelDown();
  if (!down) return null;
  return (
    <div className="refresh-failed" role="status">
      The AI model is not answering right now, so a request may fail. The rest of the portal is not affected.
    </div>
  );
}

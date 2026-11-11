import { useCapabilities } from './useAi';

const SENT = {
  explain: 'To write this, the details shown here were sent to',
  assistant: 'Each question, and a summary of the estate, is sent to',
};

/**
 * Says next to an AI answer when the question left this machine:
 * the hosted portal names Anthropic, and a local model shows nothing.
 * Inherits the footer's own type, so it adds no style of its own.
 */
export default function AiDataNotice({ kind }: { kind: keyof typeof SENT }) {
  const { aiExternal, aiProvider } = useCapabilities();
  if (!aiExternal) return null;
  const service = aiProvider === 'anthropic' ? 'Anthropic, an external AI service' : 'an external AI service';
  return <div>{`${SENT[kind]} ${service}.`}</div>;
}

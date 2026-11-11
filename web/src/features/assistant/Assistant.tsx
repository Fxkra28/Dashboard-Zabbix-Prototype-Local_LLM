import { useEffect, useRef, useState } from 'react';
import { chatStream, chatWarm } from '../../api';
import { useCapabilities } from './useAi';
import { loadConversation, saveConversation } from '../../shared/lib/chatStore';
import { useAuth, roleAllows } from '../../shared/hooks/useAuth';
import type { ChatContext, ChatMessage } from '../../types';
import { Empty, Loading } from '../../shared/components/states';
import Markdown from './Markdown';
import AiDataNotice from './AiDataNotice';
import ModelOfflineNotice from './ModelOfflineNotice';
import { count } from '../../shared/lib/plural';
import { useNow } from '../../shared/hooks/useNow';

/**
 * The Assistant page: free-form questions about the estate, answered from a
 * read-only snapshot the BFF takes for every message (see server services/assistant.ts).
 *
 * Nothing is stored server-side, so the whole history is sent back with each
 * turn. The conversation is kept in this tab's sessionStorage, so looking at
 * another page and coming back doesn't lose it; closing the tab, Clear or
 * signing out does (shared/lib/chatStore.ts).
 */

const SUGGESTIONS = [
  'What needs attention right now?',
  'Which site is in the worst shape?',
  'Are we meeting the SLA this period?',
  'Which hosts are unreachable?',
];

/** How many turns travel with each message; the BFF then keeps the newest ~3,000 characters. */
const HISTORY = 12;

/** Within this many pixels of the end counts as "reading the latest". */
const NEAR_BOTTOM_PX = 80;

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

export function ContextStrip({ context }: { context: ChatContext | null }) {
  // The age is read from the clock, so it moves while the page stays open.
  const now = useNow(10_000);
  if (!context) {
    return (
      <div className="chat-context">
        <span>
          Ask about what is happening right now. Every answer is based on a fresh snapshot of
          Zabbix: the same data as the Problems, Sites and SLA pages.
        </span>
      </div>
    );
  }
  return (
    <div className="chat-context">
      <span className="muted">The assistant can see:</span>
      <span className="pill">
        {context.problems} open problem{context.problems === 1 ? '' : 's'}
        {context.unacknowledged ? ` · ${context.unacknowledged} unacknowledged` : ''}
      </span>
      <span className="pill">
        {count(context.hosts, 'host')} · {count(context.sites, 'site')}
      </span>
      <span className="pill">
        {context.slas} SLA{context.slas === 1 ? '' : 's'} · {context.degradedServices} degraded service
        {context.degradedServices === 1 ? '' : 's'}
      </span>
      <span className="muted">snapshot {ago(context.generatedAt, now)}</span>
      {context.truncated && (
        <span className="muted" title="The estate was too large to show the model in full">
          · partial view
        </span>
      )}
    </div>
  );
}

export default function Assistant() {
  const { ai: aiEnabled, known, failed, retry } = useCapabilities();
  const { role } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(loadConversation);
  const [draft, setDraft] = useState('');
  /** The answer being streamed; `null` while idle. */
  const [pending, setPending] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whether the reader is at the end of the log; updated as they scroll. */
  const atBottom = useRef(true);
  const busy = pending !== null;

  useEffect(() => saveConversation(messages), [messages]);

  // Keep the newest text in view as it streams in, unless the reader has
  // scrolled up to re-read something, which a jump to the end would take away.
  useEffect(() => {
    const log = logRef.current;
    if (log && atBottom.current) log.scrollTo({ top: log.scrollHeight });
  }, [messages, pending]);

  // Stop and Send swap places when an answer ends, which drops focus to the
  // page. Put it back in the box, unless the reader has moved somewhere else.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const active = document.activeElement;
      if (!active || active === document.body) inputRef.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  const onScroll = () => {
    const log = logRef.current;
    if (log) atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_BOTTOM_PX;
  };

  // Navigating away must stop the model generating for nobody.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load the local model while the reader is still typing (the BFF rate-limits this).
  useEffect(() => {
    if (aiEnabled) void chatWarm();
  }, [aiEnabled]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setError(null);
    setPending('');
    // Asking is reading the answer: follow it, and keep the cursor where the next question goes.
    atBottom.current = true;
    inputRef.current?.focus();

    const ac = new AbortController();
    abortRef.current = ac;
    let answer = '';
    try {
      await chatStream(
        next.slice(-HISTORY),
        {
          onContext: setContext,
          onToken: (t) => {
            answer += t;
            setPending(answer);
          },
          // The BFF's cleaned-up text (no think block, no sign-off) replaces the stream.
          onDone: (d) => {
            if (typeof d.text === 'string' && d.text) answer = d.text;
          },
        },
        ac.signal,
      );
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (err) {
      // Stopped by the reader: keep what arrived. Failed: keep it too, and say so.
      if (answer) setMessages((m) => [...m, { role: 'assistant', content: answer }]);
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
      abortRef.current = null;
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an IME is composing (Japanese, Chinese, …) picks a candidate; it must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy) void send(draft);
    }
  }

  // Until the server has answered, "no model" is not an answer: saying so sent people to edit server/.env for nothing.
  if (!known) {
    return (
      <div className="panel">
        {failed ? (
          <div className="state error" role="alert">
            <div style={{ fontWeight: 600 }}>Could not reach the portal server.</div>
            <div style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={retry}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <Loading label="Checking the assistant…" />
        )}
      </div>
    );
  }

  if (!aiEnabled) {
    return (
      <div className="panel">
        <Empty>
          {/* Setting names are for the portal admin; everyone else is told who to ask (UX-20). */}
          {roleAllows(role, 'admin') ? (
            <>
              The assistant needs a model configured on the BFF.
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Set <strong>AI_PROVIDER</strong> and <strong>AI_BASE_URL</strong> (local model) or{' '}
                <strong>ANTHROPIC_API_KEY</strong> in <code>server/.env</code>. Everything else on the
                portal works without it.
              </div>
            </>
          ) : (
            <>
              The assistant is not set up on this portal.
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Ask the portal admin to set it up. Everything else on the portal works without it.
              </div>
            </>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="panel chat">
      <ContextStrip context={context} />

      <div
        className="chat-log"
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label="Conversation"
      >
        {messages.length === 0 && pending === null && (
          <div className="chat-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chat-suggest" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            <div key={i} className="chat-msg assistant">
              <Markdown text={m.content} />
            </div>
          ) : (
            <div key={i} className="chat-msg user">
              {m.content}
            </div>
          ),
        )}
        {pending !== null &&
          (pending ? (
            <div className="chat-msg assistant streaming">
              <Markdown text={pending} />
            </div>
          ) : (
            <div className="chat-msg assistant streaming placeholder">Reading the estate…</div>
          ))}
        {error && <div className="chat-error">Couldn’t answer: {error}</div>}
      </div>

      <ModelOfflineNotice />
      <div className="chat-compose">
        {/* Never disabled: a disabled box loses focus, and the next question can be typed while this answer streams. */}
        <textarea
          name="question"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about problems, sites, hosts or SLAs… (Enter to send, Shift+Enter for a new line)"
          aria-label="Question for the assistant"
          rows={2}
        />
        {busy ? (
          <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={() => void send(draft)} disabled={!draft.trim()}>
            Send
          </button>
        )}
        {messages.length > 0 && !busy && (
          <button
            className="btn ghost"
            onClick={() => {
              setMessages([]);
              setContext(null);
              setError(null);
              inputRef.current?.focus();
            }}
            title="Start a new conversation"
          >
            Clear
          </button>
        )}
      </div>

      <div className="chat-foot">
        Answers are written by an AI model from a read-only snapshot of the Zabbix data. It can be
        wrong, and it cannot change anything. Confirm on the relevant page before acting.
        <AiDataNotice kind="assistant" />
      </div>
    </div>
  );
}

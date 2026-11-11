import type { ChatMessage } from '../../types';

/** Where this tab keeps the Assistant conversation; api/session.ts clears it when a session ends or begins. */
export const CHAT_STORAGE_KEY = 'hcml_chat';

/** The saved conversation, or none when storage is blocked or holds something else. */
export function loadConversation(): ChatMessage[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY) ?? '[]');
    return Array.isArray(saved)
      ? saved.filter(
          (m): m is ChatMessage =>
            (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/** True from the end of a session until the next sign-in: an answer that lands late must not write the conversation back. */
let ended = false;

export function saveConversation(messages: ChatMessage[]): void {
  if (ended) return;
  try {
    if (messages.length) sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    else sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* storage full or blocked: the conversation just won't survive leaving the page */
  }
}

function forget(): void {
  try {
    sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* storage blocked: nothing was saved */
  }
}

/** A session ended (sign-out, a refused session, another tab signing out): forget the conversation and keep it forgotten. */
export function clearConversation(): void {
  ended = true;
  forget();
}

/** A sign-in begins a conversation of its own: whatever was left is dropped, and saving is allowed again. */
export function startConversation(): void {
  ended = false;
  forget();
}

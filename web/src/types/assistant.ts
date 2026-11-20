/** The plain-language layer and the Assistant: what Explain and the chat send and receive. */

export interface ProblemExplanation {
  summary: string;
  tagsExplained: { tag: string; value: string; meaning: string }[];
  businessImpact: string;
  recommendation: string;
}

export interface SlaExplanation {
  status: string;
  plain: string;
  meetingTarget: boolean;
  recommendation: string;
  /** Nothing was measured, answered without the model; show a neutral pill. */
  noData?: boolean;
}

// Assistant (chat)
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** The language the message is in, as the BFF said in its `done` frame: the page marks it for a screen reader (UX-73). */
  lang?: 'en' | 'id';
  /** An answer that did not end by itself: the reader stopped it, the stream broke, or the model reached its length limit (UX-72). */
  cut?: 'stopped' | 'failed' | 'limit';
  /** Above the point where the assistant's memory of the conversation ended when it last answered (FR-72). Once a message falls out of that memory it does not come back. */
  forgotten?: boolean;
}

/** What the model was shown for an answer: the BFF's `context` frame. */
export interface ChatContext {
  generatedAt: number;
  hosts: number;
  sites: number;
  problems: number;
  unacknowledged: number;
  slas: number;
  degradedServices: number;
  /** The estate was too large to show in full; lists were cut. */
  truncated: boolean;
  /** Present when the model was shown only what this user's own pages show (ADR-0017): the parts it holds. A count of a part that is not here is not given. */
  shown?: string[];
}

/** The BFF's `done` frame for an answer. */
export interface ChatDone {
  /** Model wall time. */
  ms: number;
  /** The cleaned-up answer (think blocks and sign-offs removed); replaces the streamed text. */
  text?: string;
  /** Wait for the first token; null when the model produced nothing. */
  firstTokenMs?: number | null;
  /** The model stopped at its length limit, so the answer is partial. */
  truncated?: boolean;
  /** How many turns of the conversation the model was given, the question included. */
  remembered?: number;
  /** The language the answer was asked in; null when the words of the question do not show it. */
  language?: 'en' | 'id' | null;
}

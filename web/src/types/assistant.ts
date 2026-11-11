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
}

/** The BFF's `done` frame for an answer. */
export interface ChatDone {
  /** Model wall time. */
  ms: number;
  /** The cleaned-up answer (think blocks and sign-offs removed); replaces the streamed text. */
  text?: string;
  /** Wait for the first token; null when the model produced nothing. */
  firstTokenMs?: number | null;
}

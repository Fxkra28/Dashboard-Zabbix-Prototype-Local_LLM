import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatDone, ChatMessage } from '../../types';

/**
 * The conversation of the Assistant page: what is sent, what an answer that did not end by itself says of itself, where the model's memory of the conversation ends, who wrote what, in which
 * language, and the box a question is typed in (FR-72, UX-72, UX-73, UX-75; FR-76 for `send`).
 */

const { health, chatStream } = vi.hoisted(() => ({ health: vi.fn(), chatStream: vi.fn() }));
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { health },
  chatWarm: vi.fn(async () => undefined),
  chatStream,
}));
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ role: 'admin' }), roleAllows: () => true }));

type On = { onContext?: (c: unknown) => void; onToken: (t: string) => void; onDone?: (d: ChatDone) => void };

/** The model answers `text` at once, and the BFF's closing frame says what it says. */
const answers = (text: string, done: Partial<ChatDone> = {}) =>
  chatStream.mockImplementation(async (_messages: ChatMessage[], on: On) => {
    on.onToken(text);
    on.onDone?.({ ms: 1, text, ...done });
  });

async function openPage() {
  vi.resetModules();
  const { default: Assistant } = await import('./Assistant');
  render(<Assistant />);
  return screen.findByLabelText('Question for the assistant') as Promise<HTMLTextAreaElement>;
}

/** The turns of a conversation kept by the tab: n exchanges. */
const exchanges = (n: number): ChatMessage[] => Array.from({ length: n }, (_, i): ChatMessage[] => [{ role: 'user', content: `Question ${i + 1}` }, { role: 'assistant', content: `Answer ${i + 1}` }]).flat();
const keep = (messages: ChatMessage[]) => sessionStorage.setItem('hcml_chat', JSON.stringify(messages));
const ask = async (box: HTMLElement, text: string) => {
  await userEvent.setup().type(box, `${text}{Enter}`);
};

beforeEach(() => {
  health.mockReset();
  chatStream.mockReset();
  sessionStorage.clear();
  Element.prototype.scrollTo = () => undefined;
  health.mockResolvedValue({ ok: true, ts: 1, ai: true, writeBack: false, defaults: { availabilityMinSeverity: 2 } });
});

describe('the box a question is typed in (FR-72)', () => {
  it('stops at 2,000 characters, which is all of a message that the assistant reads', async () => {
    const box = await openPage();
    expect(box).toHaveAttribute('maxLength', '2000');
  });

  it('shows no count for a short question, and counts from 1,800 characters', async () => {
    const box = await openPage();
    fireEvent.change(box, { target: { value: 'x'.repeat(1_799) } });
    expect(screen.queryByText(/of 2,000 characters/)).toBeNull();
    fireEvent.change(box, { target: { value: 'x'.repeat(1_850) } });
    expect(screen.getByText(/1,850 of 2,000 characters/)).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription(/1,850 of 2,000 characters/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says at the limit that the rest of a longer text was cut off', async () => {
    const box = await openPage();
    fireEvent.change(box, { target: { value: 'x'.repeat(2_000) } });
    expect(screen.getByText(/2,000 of 2,000 characters/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('the most the assistant reads');
    expect(screen.getByRole('status')).toHaveTextContent('the rest was cut off');
  });
});

describe('where the model’s memory of the conversation ends (FR-72)', () => {
  const position = (a: Node, b: Node) => a.compareDocumentPosition(b);

  it('draws a line above the first turn the model was given, when it was given only the newest', async () => {
    keep(exchanges(3));
    const box = await openPage();
    // Seven turns went to the BFF, the model was given the newest three: the four before them are out of its memory.
    answers('Answer 4', { remembered: 3 });
    await ask(box, 'Question 4');
    // A note and not a separator: a separator has presentational children in ARIA, so a screen reader may leave out the words of the line.
    const line = await screen.findByRole('note');
    expect(line).toHaveTextContent('Above this line the assistant does not remember');
    expect(line).toHaveTextContent('Clear starts a new conversation');
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(position(screen.getByText('Answer 2'), line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(position(line, screen.getByText('Question 3')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws nothing while the model was given the whole conversation', async () => {
    keep(exchanges(1));
    const box = await openPage();
    answers('Answer 2', { remembered: 3 });
    await ask(box, 'Question 2');
    await screen.findByText('Answer 2');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('draws nothing for a BFF that does not say, as before', async () => {
    keep(exchanges(3));
    const box = await openPage();
    answers('Answer 4');
    await ask(box, 'Question 4');
    await screen.findByText('Answer 4');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('moves the line down with the next answer, and what fell out of memory stays out', async () => {
    keep(exchanges(3));
    const box = await openPage();
    answers('Answer 4', { remembered: 3 });
    await ask(box, 'Question 4');
    await screen.findByText('Answer 4');
    answers('Answer 5', { remembered: 3 });
    await ask(box, 'Question 5');
    await screen.findByText('Answer 5');
    const line = screen.getByRole('note');
    expect(screen.getAllByRole('note')).toHaveLength(1);
    // Nine turns, three remembered: the line is above Question 4.
    expect(position(screen.getByText('Answer 3'), line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(position(line, screen.getByText('Question 4')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is there again when the tab keeps the conversation and the page opens again', async () => {
    keep(exchanges(3));
    const box = await openPage();
    answers('Answer 4', { remembered: 3 });
    await ask(box, 'Question 4');
    await screen.findByRole('note');
    expect(sessionStorage.getItem('hcml_chat')).toContain('"forgotten":true');
    document.body.innerHTML = '';
    await openPage();
    expect(await screen.findByRole('note')).toBeInTheDocument();
  });

  it('goes with Clear, which starts afresh', async () => {
    keep(exchanges(3));
    const box = await openPage();
    answers('Answer 4', { remembered: 3 });
    await ask(box, 'Question 4');
    await screen.findByRole('note');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText('Question 1')).toBeNull();
    expect(sessionStorage.getItem('hcml_chat')).toBeNull();
    expect(screen.getByRole('button', { name: 'What needs attention right now?' })).toBeInTheDocument();
  });
});

// DC-74: since FR-65 and FR-66 a question reads the past, the values, a host's details and other SLA windows on the spot, and the snapshot is reused for five minutes: the page says so.
describe('what the page says about where an answer comes from (DC-74)', () => {
  it('says in the strip before the first answer that a question may reach back and ask for a host, and that the snapshot is up to five minutes old, and not that it is fresh', async () => {
    await openPage();
    const strip = document.querySelector('.chat-context') as HTMLElement;
    expect(strip).toHaveTextContent(/what happened before/);
    expect(strip).toHaveTextContent(/up to five minutes old/);
    expect(strip).not.toHaveTextContent(/fresh snapshot/);
  });

  it('says in the footer that the answer comes from a read-only snapshot and from what the question asks for beyond it, which is read on the spot', async () => {
    await openPage();
    const foot = document.querySelector('.chat-foot') as HTMLElement;
    expect(foot).toHaveTextContent(/read-only snapshot/);
    expect(foot).toHaveTextContent(/and from what the question asks for beyond it/);
    expect(foot).toHaveTextContent(/it cannot change anything/);
  });

  it('suggests a question about the past, so that the page shows that last night can be asked about', async () => {
    await openPage();
    expect(screen.getByRole('button', { name: 'What happened last night?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What needs attention right now?' })).toBeInTheDocument();
  });
});

describe('who wrote what, and an answer that did not end by itself (UX-72)', () => {
  it('says You or Assistant at the start of each bubble, for a reader who hears the conversation', async () => {
    const box = await openPage();
    answers('Two hosts are down.');
    await ask(box, 'Which hosts are down?');
    const answer = (await screen.findByText('Two hosts are down.')).closest('.chat-msg') as HTMLElement;
    expect(within(answer).getByText('Assistant:')).toHaveClass('sr-only');
    const question = screen.getByText('Which hosts are down?').closest('.chat-msg') as HTMLElement;
    expect(within(question).getByText('You:')).toHaveClass('sr-only');
  });

  it('keeps what had arrived when the reader presses Stop, and marks it as partial', async () => {
    const box = await openPage();
    chatStream.mockImplementation(
      (_messages: ChatMessage[], on: On, signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          on.onToken('Part of an answer');
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await ask(box, 'Which hosts are down?');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopped: this answer is partial.')).toBeInTheDocument();
    expect(screen.getByText('Part of an answer')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t answer/)).toBeNull();
  });

  it('keeps what had arrived when the stream breaks, marks it, and says what went wrong', async () => {
    const box = await openPage();
    chatStream.mockImplementation(async (_messages: ChatMessage[], on: On) => {
      on.onToken('Half of it');
      throw new Error('The answer was cut off before it finished. Ask again.');
    });
    await ask(box, 'Which hosts are down?');
    expect(await screen.findByText('Cut off: the answer ended before it was finished.')).toBeInTheDocument();
    expect(screen.getByText('Half of it')).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t answer: The answer was cut off before it finished/)).toBeInTheDocument();
  });

  it('marks an answer that stopped at the model’s length limit, which the BFF said in its closing frame', async () => {
    const box = await openPage();
    answers('A long answer that', { truncated: true });
    await ask(box, 'Tell me everything');
    expect(await screen.findByText(/the model reached its length limit, so the answer is partial/)).toBeInTheDocument();
  });

  it('marks nothing on an answer that ended by itself', async () => {
    const box = await openPage();
    answers('Two hosts.', { truncated: false });
    await ask(box, 'Which hosts are down?');
    await screen.findByText('Two hosts.');
    expect(document.querySelector('.chat-cut')).toBeNull();
  });

  it('keeps the mark in the tab’s copy, so that it is there when the page opens again', async () => {
    const box = await openPage();
    answers('A long answer that', { truncated: true });
    await ask(box, 'Tell me everything');
    await screen.findByText(/length limit/);
    expect(sessionStorage.getItem('hcml_chat')).toContain('"cut":"limit"');
  });

  it('shows no empty bubble for a closing frame with no answer, and says so', async () => {
    const box = await openPage();
    chatStream.mockImplementation(async (_messages: ChatMessage[], on: On) => on.onDone?.({ ms: 1, text: '' }));
    await ask(box, 'Which hosts are down?');
    expect(await screen.findByText(/The assistant sent no answer/)).toBeInTheDocument();
    expect(document.querySelectorAll('.chat-msg.assistant')).toHaveLength(0);
  });
});

describe('the language of a message (UX-73)', () => {
  it('marks the question and the answer as Bahasa Indonesia when the BFF says the answer was asked for in it', async () => {
    const box = await openPage();
    answers('Dua host mati.', { language: 'id' });
    await ask(box, 'Berapa host yang mati?');
    const answer = (await screen.findByText('Dua host mati.')).closest('.chat-msg') as HTMLElement;
    expect(answer).toHaveAttribute('lang', 'id');
    expect(screen.getByText('Berapa host yang mati?').closest('.chat-msg')).toHaveAttribute('lang', 'id');
  });

  it('marks English as English, and leaves a message the BFF could not place to the page’s own language', async () => {
    const box = await openPage();
    answers('Two hosts.', { language: 'en' });
    await ask(box, 'Which hosts are down?');
    expect((await screen.findByText('Two hosts.')).closest('.chat-msg')).toHaveAttribute('lang', 'en');
    answers('MOPU is fine.', { language: null });
    await ask(box, 'MOPU?');
    expect((await screen.findByText('MOPU is fine.')).closest('.chat-msg')).not.toHaveAttribute('lang');
  });

  // WCAG 3.1.2: the words of the page are English and sit inside a message in another language; a reader would say them in that voice unless they are marked.
  it('marks the words of the page inside a message in Bahasa Indonesia as English: the labels read aloud, and the note of a cut answer', async () => {
    const box = await openPage();
    chatStream.mockImplementation(async (_messages: ChatMessage[], on: On) => {
      on.onToken?.('Dua host');
      on.onDone?.({ ms: 1, text: 'Dua host mati.', truncated: true, language: 'id' });
    });
    await ask(box, 'Berapa host yang mati?');
    const answer = (await screen.findByText('Dua host mati.')).closest('.chat-msg') as HTMLElement;
    expect(answer).toHaveAttribute('lang', 'id');
    const label = answer.querySelector('.sr-only') as HTMLElement;
    expect(label).toHaveTextContent('Assistant:');
    expect(label).toHaveAttribute('lang', 'en');
    expect(answer.querySelector('.chat-cut')).toHaveAttribute('lang', 'en');
    const question = screen.getByText('Berapa host yang mati?').closest('.chat-msg') as HTMLElement;
    expect(question.querySelector('.sr-only')).toHaveTextContent('You:');
    expect(question.querySelector('.sr-only')).toHaveAttribute('lang', 'en');
  });

  it('keeps the language in the tab’s copy', async () => {
    const box = await openPage();
    answers('Dua host mati.', { language: 'id' });
    await ask(box, 'Berapa host yang mati?');
    await screen.findByText('Dua host mati.');
    expect(sessionStorage.getItem('hcml_chat')).toContain('"lang":"id"');
  });
});

describe('the conversation can be scrolled with the keyboard (UX-75)', () => {
  it('takes focus, so that a browser that does not make a scroller focusable by itself still lets the keys scroll it', async () => {
    await openPage();
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('tabindex', '0');
    expect(log).toHaveAccessibleName('Conversation');
  });
});

describe('sending a question (FR-76)', () => {
  it('sends on Enter, and on Send', async () => {
    const box = await openPage();
    answers('Fine.');
    await ask(box, 'First');
    await waitFor(() => expect(chatStream).toHaveBeenCalledTimes(1));
    await userEvent.setup().type(box, 'Second');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(chatStream).toHaveBeenCalledTimes(2));
  });

  it('puts a new line in the box on Shift+Enter and sends nothing', async () => {
    const box = await openPage();
    await userEvent.setup().type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect(box.value).toBe('one\ntwo');
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('does not send on the Enter that picks a candidate of an input method', async () => {
    const box = await openPage();
    fireEvent.change(box, { target: { value: 'ホスト' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(chatStream).not.toHaveBeenCalled();
    expect(box.value).toBe('ホスト');
  });

  it('sends nothing for a box with only blanks, and keeps Send off', async () => {
    const box = await openPage();
    fireEvent.change(box, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('sends the newest twelve turns, the question last', async () => {
    keep(exchanges(7));
    const box = await openPage();
    answers('Fine.');
    await ask(box, 'Question 8');
    await waitFor(() => expect(chatStream).toHaveBeenCalled());
    const sent = chatStream.mock.calls[0][0] as ChatMessage[];
    expect(sent).toHaveLength(12);
    // Fifteen turns with the new question: the newest twelve begin with the answer to Question 2 (the BFF drops a leading answer, since a conversation opens with the user).
    expect(sent[0]).toMatchObject({ role: 'assistant', content: 'Answer 2' });
    expect(sent[sent.length - 1]).toMatchObject({ role: 'user', content: 'Question 8' });
  });

  it('shows Stop in place of Send while an answer streams, and refuses a second question meanwhile', async () => {
    const box = await openPage();
    chatStream.mockImplementation(() => new Promise(() => undefined));
    await ask(box, 'First');
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.setup().type(box, 'Second{Enter}');
    expect(chatStream).toHaveBeenCalledTimes(1);
  });

  it('puts the cursor back in the box when an answer ends', async () => {
    const box = await openPage();
    answers('Fine.');
    await ask(box, 'First');
    await screen.findByText('Fine.');
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('follows the answer as it streams, until the reader scrolls up to re-read something', async () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    const box = await openPage();
    let push!: (t: string) => void;
    let finish!: () => void;
    chatStream.mockImplementation(
      (_messages: ChatMessage[], on: On) =>
        new Promise<void>((resolve) => {
          push = on.onToken;
          finish = resolve;
        }),
    );
    await ask(box, 'First');
    await screen.findByRole('button', { name: 'Stop' });
    act(() => push('One '));
    const followed = scrollTo.mock.calls.length;
    expect(followed).toBeGreaterThan(0);
    // The reader scrolls up: more text does not take them back to the end.
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1_000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(log, 'scrollTop', { configurable: true, value: 100 });
    fireEvent.scroll(log);
    act(() => push('Two '));
    expect(scrollTo.mock.calls.length).toBe(followed);
    act(() => finish());
  });
});

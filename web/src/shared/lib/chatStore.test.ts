import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_STORAGE_KEY,
  clearConversation,
  loadConversation,
  saveConversation,
  startConversation,
} from './chatStore';

afterEach(() => {
  vi.restoreAllMocks();
  // clearConversation ends saving for the module: begin again, so the next test starts signed in.
  startConversation();
  sessionStorage.clear();
});

describe('the saved Assistant conversation', () => {
  it('is kept under hcml_chat in this tab and read back', () => {
    const turns = [
      { role: 'user' as const, content: 'Which hosts are unreachable?' },
      { role: 'assistant' as const, content: 'Two at MOPU.' },
    ];
    saveConversation(turns);
    expect(CHAT_STORAGE_KEY).toBe('hcml_chat');
    expect(sessionStorage.getItem('hcml_chat')).toBe(JSON.stringify(turns));
    expect(loadConversation()).toEqual(turns);
  });

  it('is removed by saving an empty conversation, and by clearConversation', () => {
    saveConversation([{ role: 'user', content: 'hi' }]);
    saveConversation([]);
    expect(sessionStorage.getItem('hcml_chat')).toBeNull();

    saveConversation([{ role: 'user', content: 'hi' }]);
    clearConversation();
    expect(sessionStorage.getItem('hcml_chat')).toBeNull();
    expect(loadConversation()).toEqual([]);
  });

  it('stays removed after a session ends: a late save writes nothing, until the next sign-in', () => {
    const turns = [{ role: 'user' as const, content: 'hi' }];
    saveConversation(turns);
    clearConversation();

    // An answer that lands after sign-out began would otherwise write the conversation back.
    saveConversation([...turns, { role: 'assistant' as const, content: 'late answer' }]);
    expect(sessionStorage.getItem('hcml_chat')).toBeNull();

    startConversation();
    saveConversation(turns);
    expect(sessionStorage.getItem('hcml_chat')).toBe(JSON.stringify(turns));
  });

  it('is dropped by startConversation too, for whoever was here before', () => {
    sessionStorage.setItem('hcml_chat', JSON.stringify([{ role: 'user', content: 'left behind' }]));
    startConversation();
    expect(loadConversation()).toEqual([]);
  });

  it('keeps only well-formed turns, and reads anything else as no conversation', () => {
    sessionStorage.setItem('hcml_chat', JSON.stringify([{ role: 'user', content: 'ok' }, { role: 'system', content: 'x' }, { role: 'user' }, null, 7]));
    expect(loadConversation()).toEqual([{ role: 'user', content: 'ok' }]);
    for (const junk of ['not json', '{"a":1}', '"text"', 'null']) {
      sessionStorage.setItem('hcml_chat', junk);
      expect(loadConversation(), junk).toEqual([]);
    }
  });

  it('survives storage that throws, as it does in some private windows', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(loadConversation()).toEqual([]);
    expect(() => saveConversation([{ role: 'user', content: 'hi' }])).not.toThrow();
    expect(() => saveConversation([])).not.toThrow();
    expect(() => clearConversation()).not.toThrow();
  });
});

describe('the marks a saved conversation carries (FR-72, UX-72, UX-73)', () => {
  it('keeps the language, the cut mark and the memory mark of a message, and only those', () => {
    sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([
        { role: 'user', content: 'Berapa host yang mati?', lang: 'id', forgotten: true, extra: 'x' },
        { role: 'assistant', content: 'Dua host.', lang: 'id', cut: 'stopped' },
      ]),
    );
    expect(loadConversation()).toEqual([
      { role: 'user', content: 'Berapa host yang mati?', lang: 'id', forgotten: true },
      { role: 'assistant', content: 'Dua host.', lang: 'id', cut: 'stopped' },
    ]);
  });

  it('drops a mark that is not one the page writes, since it ends up in an attribute and a sentence', () => {
    sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([{ role: 'assistant', content: 'Dua host.', lang: '"><script>', cut: 'because', forgotten: 'yes' }]),
    );
    expect(loadConversation()).toEqual([{ role: 'assistant', content: 'Dua host.' }]);
  });
});

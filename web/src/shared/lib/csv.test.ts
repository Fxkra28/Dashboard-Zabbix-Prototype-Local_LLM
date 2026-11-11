import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell, downloadCsv, toCsv } from './csv';
import { REVOKE_AFTER_MS } from './saveFile';

describe('csvCell', () => {
  it('quotes every cell and doubles the quotes inside it', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('plain')).toBe('"plain"');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\t=1+1', '\r=1+1'])('prefixes an apostrophe when a text cell starts the way a formula does: %j', (text) => {
    expect(csvCell(text)).toBe(`"'${text}"`);
  });

  it('leaves a cell alone when the formula character is not first', () => {
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell(' =1')).toBe('" =1"');
  });

  it('keeps a number as it is, minus sign included', () => {
    expect(csvCell(-12)).toBe('"-12"');
    expect(csvCell(0.5)).toBe('"0.5"');
  });

  it('guards a non-finite number like text, and shows a missing value as an empty cell', () => {
    expect(csvCell(-Infinity)).toBe(`"'-Infinity"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with newlines', () => {
    expect(toCsv([['host', 'n'], ['a', 1]])).toBe('"host","n"\n"a","1"');
  });

  it('guards the cells of every row, header included', () => {
    expect(toCsv([['=x'], ['@y', '-3']])).toBe(`"'=x"\n"'@y","'-3"`);
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Runs downloadCsv with the browser's file saving replaced, and hands back what was saved and how. */
  function save(rows: unknown[][]) {
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((saved = b), 'blob:csv'));
    URL.revokeObjectURL = vi.fn();
    const clicked: { download: string; href: string; inPage: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, inPage: document.body.contains(this) });
    });
    downloadCsv('x.csv', rows);
    return { saved: saved!, clicked };
  }

  it('saves the guarded text as a CSV file under the given name', async () => {
    const { saved, clicked } = save([['host'], ['=cmd|calc']]);
    expect(clicked.map(({ download, href }) => ({ download, href }))).toEqual([{ download: 'x.csv', href: 'blob:csv' }]);
    expect(saved.type).toBe('text/csv;charset=utf-8');
    expect(await saved.text()).toBe(`"host"\n"'=cmd|calc"`);
  });

  it('starts the file with a byte-order mark, so Excel reads it as UTF-8 and not as ANSI (FR-22)', async () => {
    const { saved } = save([['Suhu °C', 'Hôtel'], ['é', 'ü']]);
    const bytes = new Uint8Array(await saved.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe('\uFEFF"Suhu °C","Hôtel"\n"é","ü"');
  });

  it('puts the link in the page for the click and takes it out after, as the report downloads do (FR-22)', () => {
    const { clicked } = save([['host']]);
    expect(clicked[0].inPage).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('keeps the file address for REVOKE_AFTER_MS, since a browser that is still saving can cancel a download whose address went at once (FR-22)', () => {
    vi.useFakeTimers();
    save([['host']]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });
});

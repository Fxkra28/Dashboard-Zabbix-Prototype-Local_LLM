import { describe, expect, it } from 'vitest';
import { MAX_RECIPIENTS } from '../core/mailConfig.js';
import { checkRecipients, domainsOf, splitAddresses } from '../core/recipients.js';
import { BadRequestError } from '../core/validate.js';

/**
 * The addresses a report goes to when a person types them: the rules every list obeys, on the way in from the screen
 * and from the saved state alike. Every address here is made up.
 */

const any = { allowedDomains: [] as string[] };
const check = (input: unknown, over: Partial<Parameters<typeof checkRecipients>[1]> = {}) => checkRecipients(input, { ...any, ...over });
const refused = (input: unknown, over: Partial<Parameters<typeof checkRecipients>[1]> = {}) => {
  try {
    check(input, over);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestError);
    return (err as Error).message;
  }
  throw new Error('was accepted');
};

describe('a good list', () => {
  it('comes back as it was given, trimmed', () => {
    expect(check(['ana@example.org', '  budi@example.org '])).toEqual(['ana@example.org', 'budi@example.org']);
  });

  it('is listed once: a repeat, in any case, is dropped and the first spelling stays', () => {
    expect(check(['Ana@Example.org', 'ana@example.org', 'budi@example.org', 'BUDI@example.ORG'])).toEqual(['Ana@Example.org', 'budi@example.org']);
  });

  it('may be empty when nothing is needed, and blank entries are not addresses', () => {
    expect(check([])).toEqual([]);
    expect(check(['', '  ', 'ana@example.org'])).toEqual(['ana@example.org']);
  });

  it(`holds up to ${MAX_RECIPIENTS} addresses by default`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.org`);
    expect(check(many(MAX_RECIPIENTS))).toHaveLength(MAX_RECIPIENTS);
    expect(refused(many(MAX_RECIPIENTS + 1))).toBe(`Recipients: at most ${MAX_RECIPIENTS} addresses.`);
  });

  it('counts the addresses that remain, not the entries: repeats and blanks do not use up the limit', () => {
    const padded = [...Array.from({ length: MAX_RECIPIENTS }, (_, i) => `p${i}@example.org`), 'P0@example.org', '', ' '];
    expect(check(padded)).toHaveLength(MAX_RECIPIENTS);
  });

  it('takes a limit of its own', () => {
    expect(check(['a@example.org', 'b@example.org', 'c@example.org'], { max: 3 })).toHaveLength(3);
    expect(refused(['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'], { max: 3, what: 'Failure notices' })).toBe('Failure notices: at most 3 addresses.');
  });

  it('can be required to hold one', () => {
    expect(refused([], { min: 1 })).toBe('Recipients: add at least one address.');
    expect(refused(['', ' '], { min: 1 })).toBe('Recipients: add at least one address.');
    expect(check(['ana@example.org'], { min: 1 })).toEqual(['ana@example.org']);
  });
});

describe('something that is not a list of addresses', () => {
  it.each([[undefined], [null], ['ana@example.org'], [5], [{}], [true]])('is refused: %j', (input) => {
    expect(refused(input)).toBe('Recipients must be a list of addresses.');
  });

  it.each([[[1]], [[null]], [[['ana@example.org']]], [[{ a: 1 }]]])('is refused when an entry is not text: %j', (input) => {
    expect(refused(input)).toBe('Recipients must be a list of addresses.');
  });

  it('names what it checks in the sentence', () => {
    expect(refused('x', { what: 'Failure notices' })).toBe('Failure notices must be a list of addresses.');
  });
});

describe('an address with the punctuation real ones use', () => {
  it.each(["o'brien@example.org", 'first.last+tag@example.org', 'a_b-c@example.org', 'ana=budi@example.org', 'ana$@example.org'])('is still taken: %s', (address) => {
    expect(checkRecipients([address], { allowedDomains: [] })).toEqual([address]);
  });
});

describe('an address that is not plain', () => {
  it.each([
    'ana@',
    '@example.org',
    'ana@example',
    'ana example.org',
    'Ana <ana@example.org>',
    '"ana"@example.org',
    'ana@@example.org',
    'a,b@example.org',
    'ana@example.org;budi@example.org',
    // A mail server that still reads these in the part before the @ may deliver to the domain they name, or run a command.
    'ana%evil.example.net@example.org',
    'evil.example.net!ana@example.org',
    'ana|tool@example.org',
    'ana/tool@example.org',
  ])(
    'is refused: %s',
    (address) => {
      expect(refused(['budi@example.org', address])).toBe(`Recipients: "${address}" is not a plain address such as name@example.com.`);
    },
  );

  it.each(['ana@example.org\r\nBcc: spy@example.net', 'ana@example.org\nCc: x@example.net', 'ana\u0000@example.org', 'ana@exam\tple.org'])(
    'is refused when it carries a line break or another control character, which is how a header gets forged',
    (address) => {
      const message = refused([address]);
      expect(message).toMatch(/^Recipients: ".*" is not a plain address/);
      expect(/\p{Cc}/u.test(message)).toBe(false);
    },
  );

  it('is shown cut short in the sentence, so a pasted page cannot flood it', () => {
    const message = refused([`${'x'.repeat(200)}@example.org`]);
    expect(message.length).toBeLessThan(120);
    expect(message).toContain('...');
  });
});

describe('the domains a report may go to', () => {
  const only = { allowedDomains: ['example.org', 'hcml.co.id'] };

  it('let an address inside them through, in any case', () => {
    expect(check(['ana@example.org', 'Budi@HCML.co.id'], only)).toEqual(['ana@example.org', 'Budi@HCML.co.id']);
  });

  it('refuse an address outside them and say which, and where reports may go', () => {
    expect(refused(['ana@example.org', 'spy@elsewhere.net'], only)).toBe(
      'Recipients: spy@elsewhere.net is outside the domains this portal may send to (example.org, hcml.co.id).',
    );
  });

  it('take the whole domain: a sub-domain, or a domain that merely ends the same way, is outside', () => {
    expect(refused(['ana@mail.example.org'], only)).toMatch(/outside the domains/);
    expect(refused(['ana@notexample.org'], only)).toMatch(/outside the domains/);
    expect(refused(['ana@example.org.evil.net'], only)).toMatch(/outside the domains/);
  });

  it('are not asked when none are named', () => {
    expect(check(['ana@anything.example'])).toEqual(['ana@anything.example']);
  });

  it('are listed cut short in the sentence when there are many', () => {
    const many = Array.from({ length: 12 }, (_, i) => `d${i}.example.net`);
    const message = refused(['ana@elsewhere.org'], { allowedDomains: many });
    expect(message).toContain('d0.example.net');
    expect(message).toContain('...');
    expect(message).not.toContain('d11.example.net');
  });
});

describe('the order of the checks', () => {
  it('says a bad address before it says too many, and too many before an outside domain', () => {
    const many = [...Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@elsewhere.net`)];
    expect(refused([...many, 'nope'], { allowedDomains: ['example.org'] })).toMatch(/not a plain address/);
    expect(refused(many, { allowedDomains: ['example.org'] })).toMatch(/at most/);
  });
});

describe('splitAddresses', () => {
  it('splits what a person typed on commas, semicolons, spaces and line breaks', () => {
    expect(splitAddresses('ana@example.org, budi@example.org;cici@example.org\ndedi@example.org\r\n  eka@example.org')).toEqual([
      'ana@example.org',
      'budi@example.org',
      'cici@example.org',
      'dedi@example.org',
      'eka@example.org',
    ]);
  });

  it('gives an empty list for nothing', () => {
    expect(splitAddresses('')).toEqual([]);
    expect(splitAddresses('  \n ')).toEqual([]);
  });
});

describe('domainsOf', () => {
  it('lists the domains of the addresses once, in lower case, in the order they appear, and no name', () => {
    expect(domainsOf(['ana@Example.org', 'budi@hcml.co.id', 'cici@example.ORG'])).toEqual(['example.org', 'hcml.co.id']);
    expect(domainsOf([])).toEqual([]);
  });
});

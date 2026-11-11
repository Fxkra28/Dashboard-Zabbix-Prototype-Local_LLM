import { MAX_RECIPIENTS, addressDomain, plainAddress } from './mailConfig.js';
import { BadRequestError } from './validate.js';

/**
 * The addresses a report goes to when a person types them. One set of rules for a list that comes from the screen and
 * for one read back from the saved state, so neither can hold what the other would refuse.
 */

export interface RecipientRules {
  /** Lower case. Empty: any domain. */
  allowedDomains: readonly string[];
  /** The fewest addresses. Default 0. */
  min?: number;
  /** The most addresses. Default MAX_RECIPIENTS. */
  max?: number;
  /** What the list is called in a sentence. Default "Recipients". */
  what?: string;
}

const clip = (text: string, max = 40): string => {
  const flat = text.replace(/\p{Cc}+/gu, ' ');
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/** Text typed in a box, as a list: commas, semicolons, spaces and line breaks all separate. */
export const splitAddresses = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean);

/** The domains of the addresses, once each, in lower case, in the order they appear. */
export const domainsOf = (addresses: readonly string[]): string[] => [...new Set(addresses.map(addressDomain))];

export function checkRecipients(input: unknown, rules: RecipientRules): string[] {
  const what = rules.what ?? 'Recipients';
  if (!Array.isArray(input) || input.some((a) => typeof a !== 'string')) throw new BadRequestError(`${what} must be a list of addresses.`);

  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of input as string[]) {
    const address = entry.trim();
    if (address === '' || seen.has(address.toLowerCase())) continue;
    if (!plainAddress(address)) throw new BadRequestError(`${what}: "${clip(address)}" is not a plain address such as name@example.com.`);
    seen.add(address.toLowerCase());
    list.push(address);
  }

  const max = rules.max ?? MAX_RECIPIENTS;
  if (list.length > max) throw new BadRequestError(`${what}: at most ${max} addresses.`);
  if (list.length < (rules.min ?? 0)) throw new BadRequestError(`${what}: add at least one address.`);

  if (rules.allowedDomains.length > 0) {
    const outside = list.find((a) => !rules.allowedDomains.includes(addressDomain(a)));
    if (outside) {
      const shown = rules.allowedDomains.slice(0, 5).join(', ');
      throw new BadRequestError(`${what}: ${outside} is outside the domains this portal may send to (${shown}${rules.allowedDomains.length > 5 ? ', ...' : ''}).`);
    }
  }
  return list;
}

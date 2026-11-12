/** Text typed in a box, as a list of addresses: commas, semicolons, spaces and line breaks all separate them. */
export const splitAddresses = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean);

/** A list of addresses as the box shows it: one on each line. */
export const joinAddresses = (list: readonly string[]): string => list.join('\n');

/** "a", "a and b", "a, b and c". */
export function wordsList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What a person should know before a list is typed: the report is one message, and a message shows its To line (SC-50). */
export const SEE_EACH_OTHER = 'The report goes as one message, so each person can see the other addresses.';

/** The domains an address may be in, as a sentence part: "example.org", "example.org or hcml.co.id". */
export function domainsList(domains: readonly string[]): string {
  if (domains.length <= 1) return domains.join('');
  return `${domains.slice(0, -1).join(', ')} or ${domains[domains.length - 1]}`;
}

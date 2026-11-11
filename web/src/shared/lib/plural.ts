/** A count with its noun, "1 host" and "2 hosts". Pass the plural for the nouns that do not just add an s. */
export const count = (n: number, noun: string, plural = `${noun}s`): string => `${n} ${n === 1 ? noun : plural}`;

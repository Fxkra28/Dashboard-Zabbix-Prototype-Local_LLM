/** A graph has a scale on each side, so it can hold two kinds of unit at most. */
export const MAX_UNIT_SCALES = 2;

/** The kinds of unit among these, each once, in the order it first appears; no unit is a kind of its own. */
export const unitFamilies = (units: (string | undefined)[]): string[] => [...new Set(units.map((u) => u ?? ''))];

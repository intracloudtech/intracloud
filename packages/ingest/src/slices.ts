import { SLICES } from "./config.js";

/**
 * A `size:` partition as a numeric byte range. `max === null` means unbounded.
 * Ranges are INCLUSIVE on both ends (matching GitHub's `size:` semantics), so
 * neighbouring ranges must not share a boundary value.
 */
export interface SizeRange {
  min: number;
  max: number | null;
}

/** Parse one of the SLICES qualifier strings into a numeric range. */
export function parseSlice(qualifier: string): SizeRange {
  const q = qualifier.replace(/^size:/, "").trim();
  let m: RegExpMatchArray | null;
  if ((m = q.match(/^<=(\d+)$/))) return { min: 0, max: Number(m[1]) };
  if ((m = q.match(/^<(\d+)$/))) return { min: 0, max: Number(m[1]) - 1 };
  if ((m = q.match(/^>=(\d+)$/))) return { min: Number(m[1]), max: null };
  if ((m = q.match(/^>(\d+)$/))) return { min: Number(m[1]) + 1, max: null };
  if ((m = q.match(/^(\d+)\.\.(\d+)$/)))
    return { min: Number(m[1]), max: Number(m[2]) };
  throw new Error(`unparseable size slice: ${qualifier}`);
}

/** Render a range back to a GitHub `size:` qualifier. */
export function rangeToQualifier(r: SizeRange): string {
  if (r.max === null) return `size:>=${r.min}`;
  if (r.min === 0) return `size:<=${r.max}`;
  return `size:${r.min}..${r.max}`;
}

/** Split a saturated range into two disjoint halves. */
export function splitRange(r: SizeRange): [SizeRange, SizeRange] {
  if (r.max === null) {
    // unbounded: double the floor
    const mid = Math.max(r.min * 2, r.min + 1);
    return [
      { min: r.min, max: mid },
      { min: mid + 1, max: null },
    ];
  }
  if (r.max - r.min < 1) {
    throw new Error(`range too small to split: ${JSON.stringify(r)}`);
  }
  const mid = Math.floor((r.min + r.max) / 2);
  return [
    { min: r.min, max: mid },
    { min: mid + 1, max: r.max },
  ];
}

/** True if no two ranges overlap. */
export function rangesDisjoint(ranges: SizeRange[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevMax = prev.max ?? Infinity;
    if (cur.min <= prevMax) return false;
  }
  return true;
}

/** The default slices, parsed into ranges. */
export function defaultRanges(): SizeRange[] {
  return SLICES.map(parseSlice);
}

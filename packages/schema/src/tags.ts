/**
 * Tag normalization. Shared so ingest and site agree byte-for-byte on what a
 * tag "is" — the same string must produce the same slug in both places.
 */

/** Normalize a single tag token. Returns "" for tags that reduce to nothing. */
export const norm = (t: string): string =>
  t
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "") // keep unicode letters + numbers
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

export interface TagOptions {
  /** alias map: normalized-key -> normalized-value (e.g. k8s -> kubernetes). */
  aliases?: Record<string, string>;
  /** blocked normalized tags. */
  blocklist?: string[];
  /** max tags kept (default 5). */
  cap?: number;
}

/**
 * Normalize a list of raw author tags:
 *   normalize → drop empties → apply aliases → drop blocklist → dedupe → cap.
 */
export function normalizeTags(
  raw: readonly string[] | undefined,
  opts: TagOptions = {},
): string[] {
  const { aliases = {}, blocklist = [], cap = 5 } = opts;
  const blocked = new Set(blocklist.map(norm).filter(Boolean));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const t of raw ?? []) {
    if (typeof t !== "string") continue;
    let n = norm(t);
    if (!n) continue;
    // alias may itself need normalizing; apply once, then re-check block/seen.
    if (aliases[n] !== undefined) {
      n = norm(aliases[n]);
      if (!n) continue;
    }
    if (blocked.has(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= cap) break;
  }
  return out;
}

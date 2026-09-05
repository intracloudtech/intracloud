/** Static configuration and tuned constants for the sync. */

/**
 * Disjoint `size:` slices (bytes). Code search caps at 1000 results PER QUERY,
 * so we partition on file size to give each slice its own budget.
 *
 * Ranges must NOT touch: `size:` is inclusive on both ends, so 3000 must live
 * in exactly one slice. Tuned for markdown posts (~2–8 KB), hence no narrow
 * low-end slices.
 */
export const SLICES = [
  "size:<1000",
  "size:1000..3000",
  "size:3001..6000",
  "size:6001..12000",
  "size:>12000",
] as const;

/** The two filename variants we index. `.mdx` is treated as plain markdown. */
export const FILENAMES = ["intracloud.md", "intracloud.mdx"] as const;

/** Code search is 10 req/min. 6.5s between calls stays safely under. */
export const CODE_SEARCH_SLEEP_MS = 6500;

/** Repo search is 30 req/min. 2.1s between calls stays safely under. */
export const REPO_SEARCH_SLEEP_MS = 2100;

/**
 * Primary discovery is repository search by topic. Authors opt in by adding
 * this topic to their repo (one click) — the repo-search index is fresh and
 * reliable, unlike `/search/code`, which does not index new/small repos.
 */
export const DISCOVERY_TOPIC = process.env.INGEST_TOPIC ?? "intracloud";

/**
 * Code search is a best-effort SECONDARY source (off by default): it only
 * covers repos GitHub's legacy code index happens to have, but costs a full
 * ~4-minute throttled sweep. Enable with INGEST_CODE_SEARCH=1.
 */
export function codeSearchEnabled(env = process.env): boolean {
  return env.INGEST_CODE_SEARCH === "1";
}

export const PER_PAGE = 100;
export const MAX_PAGES = 10; // 100 * 10 = 1000 hard cap per query

/** Back off blob fetching before we run the primary rate limit dry. */
export const BLOB_RATELIMIT_FLOOR = 50;

/** Asset limits. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ASSETS_PER_POST = 30;
export const IMAGE_MAX_WIDTH = 1600;

/** A tag needs this many posts before /t/{tag} becomes a real route. */
export const MIN_POSTS_PER_TAG = 3;

/** Feed ranking caps. */
export const MAX_POSTS_PER_AUTHOR_PER_DAY = 2;

/** Production origins. */
export const SITE_ORIGIN = "https://intracloud.tech";

/**
 * Base URL that rewritten image `src`s point at.
 *
 * Default is the SITE-RELATIVE `/i` — images live in the data branch under
 * `assets/` and are served as static files alongside the site (free, no
 * object store, no card). Set `ASSET_BASE` to an absolute origin (e.g.
 * `https://cdn.intracloud.tech/i`) only if you later move assets to R2/a CDN.
 */
export function assetBase(): string {
  // NB: an unset CI `vars.ASSET_BASE` arrives as "" (not undefined), so treat
  // blank as unset and fall back to the site-relative /i.
  const b = process.env.ASSET_BASE?.trim();
  return (b && b.length > 0 ? b : "/i").replace(/\/+$/, "");
}

export const GITHUB_API = "https://api.github.com";

export const USER_AGENT = "intracloud-sync (+https://intracloud.tech)";

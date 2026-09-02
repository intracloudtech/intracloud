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
export const CDN_ORIGIN = "https://cdn.intracloud.tech";

export const GITHUB_API = "https://api.github.com";

export const USER_AGENT = "intracloud-sync (+https://intracloud.tech)";

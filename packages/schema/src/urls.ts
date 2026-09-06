/**
 * Path → URL mapping. The slug IS the repo path; nothing is author-controlled,
 * so collisions are structurally impossible.
 *
 *   file `posts/hello-world/intracloud.md` in `sam/blog`
 *     → /@sam/blog/posts/hello-world
 *   file `intracloud.md` at repo root in `sam/blog`
 *     → /@sam/blog
 */

/** First path segments we own and must never let a repo shadow. */
export const RESERVED_SEGMENTS = [
  "search",
  "feed",
  "rss",
  "about",
  "api",
  "t",
  "settings",
  "_astro",
] as const;

const INTRACLOUD_FILE = /(?:^|\/)intracloud\.mdx?$/;

/** Strip the trailing intracloud.md / intracloud.mdx filename from a path. */
export function stripPostFilename(path: string): string {
  return path.replace(INTRACLOUD_FILE, "").replace(/\/+$/, "");
}

function encodeSegments(p: string): string {
  return p
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * Build the site-relative post URL. No trailing slash.
 * `owner`/`repo` come from the repository; `path` is the file path in the repo.
 */
export function postUrl(owner: string, repo: string, path: string): string {
  const dir = stripPostFilename(path);
  const base = `/@${owner}/${repo}`;
  const rest = encodeSegments(dir);
  return rest ? `${base}/${rest}` : base;
}

/** Raw-source URL: same as postUrl but keeps the `.md` suffix on the file. */
export function rawUrl(owner: string, repo: string, path: string): string {
  const dir = stripPostFilename(path);
  const base = `/@${owner}/${repo}`;
  const rest = encodeSegments(dir);
  return (rest ? `${base}/${rest}` : base) + ".md";
}

export function authorUrl(owner: string): string {
  return `/@${owner}`;
}

/**
 * A GitHub user's avatar. `https://github.com/{login}.png` is a public,
 * stable redirect to the avatar — no API, no token. `size` requests a scaled
 * copy (GitHub serves powers-of-two-ish sizes).
 */
export function avatarUrl(login: string, size = 80): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}

export function repoUrl(owner: string, repo: string): string {
  return `/@${owner}/${repo}`;
}

export function tagUrl(tag: string): string {
  return `/t/${encodeURIComponent(tag)}`;
}

/**
 * Resolve a relative link found in a post body against that post's directory,
 * returning a site-relative Intracloud URL when it points at another post,
 * or `null` when it does not resolve to one (leave the link as-authored).
 *
 * `fromPath` is the linking post's file path within its repo.
 * A link like `../rust-gc/` (dir) or `../rust-gc/intracloud.md` both map to the
 * sibling post URL.
 */
export function resolveRelativePostLink(
  owner: string,
  repo: string,
  fromPath: string,
  href: string,
): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // absolute scheme
  if (href.startsWith("//") || href.startsWith("#")) return null;
  if (href.startsWith("/")) return null; // repo-absolute; not our concern

  // separate any fragment/query
  const hashIdx = href.search(/[?#]/);
  const suffix = hashIdx >= 0 ? href.slice(hashIdx) : "";
  let rel = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

  const fromDir = stripPostFilename(fromPath); // dir of the linking post
  const baseSegs = fromDir ? fromDir.split("/") : [];

  // If the link points directly at an intracloud file, resolve its directory.
  rel = rel.replace(INTRACLOUD_FILE, "");

  const segs = [...baseSegs];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length === 0) return null; // escapes the repo
      segs.pop();
    } else {
      segs.push(part);
    }
  }
  const targetPath = segs.join("/");
  const url = targetPath ? postUrl(owner, repo, targetPath) : repoUrl(owner, repo);
  return url + suffix;
}

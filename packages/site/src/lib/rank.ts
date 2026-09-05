import type { Post } from "@intracloud/schema";
import { MIN_POSTS_PER_TAG, MAX_POSTS_PER_AUTHOR_PER_DAY } from "./constants.js";

const byDateDesc = (a: Post, b: Post) =>
  b.first_seen_at.localeCompare(a.first_seen_at);

export const live = (posts: Post[]): Post[] =>
  posts.filter((p) => !p.draft && !p.duplicate_of);

export function postsByAuthor(posts: Post[], owner: string): Post[] {
  return live(posts).filter((p) => p.author === owner).sort(byDateDesc);
}

export function postsByRepo(posts: Post[], owner: string, repo: string): Post[] {
  return live(posts)
    .filter((p) => p.author === owner && p.repo === repo)
    .sort(byDateDesc);
}

export function authors(posts: Post[]): string[] {
  return [...new Set(live(posts).map((p) => p.author))].sort();
}

export interface RepoGroup {
  owner: string;
  repo: string;
  ownerRepo: string;
  posts: Post[];
}

export function reposByAuthor(posts: Post[], owner: string): RepoGroup[] {
  const map = new Map<string, Post[]>();
  for (const p of postsByAuthor(posts, owner)) {
    let arr = map.get(p.repo);
    if (!arr) map.set(p.repo, (arr = []));
    arr.push(p);
  }
  return [...map.entries()]
    .map(([repo, ps]) => ({
      owner,
      repo,
      ownerRepo: `${owner}/${repo}`,
      posts: ps.sort(byDateDesc),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

export function tagIndex(posts: Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  for (const p of live(posts)) {
    for (const t of p.tags) {
      let arr = map.get(t);
      if (!arr) map.set(t, (arr = []));
      arr.push(p);
    }
  }
  return map;
}

/** Only tags with >= MIN_POSTS_PER_TAG get a real route. */
export function routableTags(posts: Post[]): { tag: string; posts: Post[] }[] {
  const out: { tag: string; posts: Post[] }[] = [];
  for (const [tag, ps] of tagIndex(posts)) {
    if (ps.length >= MIN_POSTS_PER_TAG) {
      out.push({ tag, posts: ps.sort(byDateDesc) });
    }
  }
  return out.sort((a, b) => b.posts.length - a.posts.length || a.tag.localeCompare(b.tag));
}

/** Cap at N posts per author per rolling 24h window. Assumes sorted desc. */
function capPerAuthorPerDay(sorted: Post[]): Post[] {
  const windows = new Map<string, number[]>();
  const out: Post[] = [];
  for (const p of sorted) {
    const t = new Date(p.first_seen_at).getTime();
    const kept = windows.get(p.author) ?? [];
    const within = kept.filter((k) => Math.abs(k - t) < 24 * 3600 * 1000);
    if (within.length >= MAX_POSTS_PER_AUTHOR_PER_DAY) continue;
    kept.push(t);
    windows.set(p.author, kept);
    out.push(p);
  }
  return out;
}

/**
 * Latest feed: reverse-chron on first_seen_at, excluding backfill + drafts +
 * duplicates, capped at N posts per author per rolling 24h window.
 */
export function latestFeed(posts: Post[]): Post[] {
  return capPerAuthorPerDay(
    live(posts).filter((p) => !p.backfill).sort(byDateDesc),
  );
}

/**
 * What the homepage shows. Prefer the strict Latest feed; but when it's empty
 * (e.g. a fresh index where every post is still backfill), fall back to recent
 * posts INCLUDING backfill so the homepage is never empty while content exists.
 * The per-author cap still applies so the fallback can't be flooded either.
 */
export function homepageFeed(posts: Post[]): { posts: Post[]; fallback: boolean } {
  const latest = latestFeed(posts);
  if (latest.length > 0) return { posts: latest, fallback: false };
  return { posts: capPerAuthorPerDay(live(posts).sort(byDateDesc)), fallback: true };
}

import { readFile } from "node:fs/promises";
import type { DiscoveredFile } from "./discover.js";

/** Per-post persisted state used for change detection + stable timing. */
export interface PostState {
  blob_sha: string;
  first_seen_at: string; // ISO — the publish date, set once, never changes
  updated_at: string; // ISO — bumped whenever blob_sha changes
  backfill: boolean;
  body_hash?: string;
}

export interface State {
  version: 1;
  posts: Record<string, PostState>;
  /** repos we have synced at least once (backfill guard). */
  repos: Record<string, { first_synced_at: string }>;
}

export function emptyState(): State {
  return { version: 1, posts: {}, repos: {} };
}

export async function loadState(path: string): Promise<State> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      version: 1,
      posts: parsed.posts ?? {},
      repos: parsed.repos ?? {},
    };
  } catch {
    return emptyState();
  }
}

export type Classification =
  | {
      action: "skip";
      first_seen_at: string;
      updated_at: string;
      backfill: boolean;
      body_hash?: string;
    }
  | {
      action: "fetch";
      first_seen_at: string;
      updated_at: string; // provisional; finalized after body hashing
      backfill: boolean;
      isNew: boolean;
    };

/**
 * Decide what to do with a discovered file given prior state.
 *
 * - identical blob sha  → skip fetch entirely, reuse stored timing/backfill.
 * - changed or new      → fetch. New posts in a repo we've never synced before
 *                         are backfill:true (excluded from Latest). New posts
 *                         in an already-known repo are genuinely new.
 */
export function classifyFile(
  file: DiscoveredFile,
  state: State,
  now: string,
): Classification {
  const prev = state.posts[file.id];
  if (prev && prev.blob_sha === file.sha) {
    return {
      action: "skip",
      first_seen_at: prev.first_seen_at,
      updated_at: prev.updated_at,
      backfill: prev.backfill,
      body_hash: prev.body_hash,
    };
  }

  if (prev) {
    // existing post whose contents changed
    return {
      action: "fetch",
      first_seen_at: prev.first_seen_at,
      updated_at: now,
      backfill: prev.backfill,
      isNew: false,
    };
  }

  // brand new post
  const repoKnown = state.repos[file.ownerRepo] !== undefined;
  return {
    action: "fetch",
    first_seen_at: now,
    updated_at: now,
    backfill: !repoKnown, // first sync of a repo → backfill
    isNew: true,
  };
}

/** Build the next state object from the posts that survived this run. */
export function buildNextState(
  prev: State,
  posts: Array<{
    id: string;
    ownerRepo: string;
    blob_sha: string;
    first_seen_at: string;
    updated_at: string;
    backfill: boolean;
    body_hash: string;
  }>,
  now: string,
): State {
  const next = emptyState();
  // carry forward every repo we've ever seen, plus repos in this run
  next.repos = { ...prev.repos };
  for (const p of posts) {
    next.posts[p.id] = {
      blob_sha: p.blob_sha,
      first_seen_at: p.first_seen_at,
      updated_at: p.updated_at,
      backfill: p.backfill,
      body_hash: p.body_hash,
    };
    if (!next.repos[p.ownerRepo]) {
      next.repos[p.ownerRepo] = { first_synced_at: now };
    }
  }
  return next;
}

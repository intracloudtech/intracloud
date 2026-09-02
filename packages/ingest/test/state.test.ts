import { describe, it, expect } from "vitest";
import {
  classifyFile,
  buildNextState,
  emptyState,
  type State,
} from "../src/state.js";
import type { DiscoveredFile } from "../src/discover.js";

function file(id: string, sha: string): DiscoveredFile {
  const [owner, repo, ...rest] = id.split("/");
  return {
    id,
    owner,
    repo,
    ownerRepo: `${owner}/${repo}`,
    path: rest.join("/"),
    sha,
    gitUrl: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    isMdx: false,
  };
}

const NOW = "2026-09-02T00:00:00.000Z";

describe("change detection", () => {
  it("skips a byte-identical blob entirely", () => {
    const state: State = {
      version: 1,
      posts: {
        "sam/blog/intracloud.md": {
          blob_sha: "abc",
          first_seen_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          backfill: false,
        },
      },
      repos: { "sam/blog": { first_synced_at: "2026-01-01T00:00:00.000Z" } },
    };
    const c = classifyFile(file("sam/blog/intracloud.md", "abc"), state, NOW);
    expect(c.action).toBe("skip");
    expect(c.first_seen_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("fetches a changed blob and bumps updated_at, keeps first_seen_at", () => {
    const state: State = {
      version: 1,
      posts: {
        "sam/blog/intracloud.md": {
          blob_sha: "abc",
          first_seen_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          backfill: false,
        },
      },
      repos: { "sam/blog": { first_synced_at: "2026-01-01T00:00:00.000Z" } },
    };
    const c = classifyFile(file("sam/blog/intracloud.md", "DEF"), state, NOW);
    expect(c.action).toBe("fetch");
    expect(c.first_seen_at).toBe("2026-01-01T00:00:00.000Z");
    expect(c.updated_at).toBe(NOW);
  });
});

describe("backfill guard", () => {
  it("marks all posts backfill on a repo's first sync", () => {
    const state = emptyState();
    const a = classifyFile(file("new/repo/intracloud.md", "1"), state, NOW);
    const b = classifyFile(file("new/repo/posts/x/intracloud.md", "2"), state, NOW);
    expect(a.action).toBe("fetch");
    expect(a.backfill).toBe(true);
    expect(b.backfill).toBe(true);
  });

  it("marks only genuinely-new posts on a subsequent sync", () => {
    // first sync
    let state = emptyState();
    const first = [
      { f: file("new/repo/intracloud.md", "1") },
      { f: file("new/repo/old/intracloud.md", "2") },
    ].map(({ f }) => {
      const c = classifyFile(f, state, NOW);
      return { file: f, c };
    });
    state = buildNextState(
      state,
      first.map(({ file, c }) => ({
        id: file.id,
        ownerRepo: file.ownerRepo,
        blob_sha: file.sha,
        first_seen_at: c.first_seen_at,
        updated_at: c.updated_at,
        backfill: c.backfill,
        body_hash: "h",
      })),
      NOW,
    );

    // second sync: same two files unchanged + one brand-new file
    const LATER = "2026-09-03T00:00:00.000Z";
    const unchanged = classifyFile(file("new/repo/intracloud.md", "1"), state, LATER);
    const brandNew = classifyFile(file("new/repo/fresh/intracloud.md", "9"), state, LATER);

    expect(unchanged.action).toBe("skip");
    expect(unchanged.backfill).toBe(true); // stays backfill, but it's skipped
    expect(brandNew.action).toBe("fetch");
    expect(brandNew.backfill).toBe(false); // repo known now → genuinely new
  });
});

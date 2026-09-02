import { describe, it, expect } from "vitest";
import { shardFeedByMonth, buildSearchIndex } from "../src/datawriter.js";
import type { Post } from "@intracloud/schema";

function post(over: Partial<Post>): Post {
  return {
    id: "a/b/intracloud.md",
    author: "a",
    repo: "b",
    ownerRepo: "a/b",
    path: "intracloud.md",
    url: "/@a/b",
    rawUrl: "/@a/b.md",
    title: "T",
    tags: [],
    draft: false,
    first_seen_at: "2026-01-15T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:00.000Z",
    blob_sha: "sha",
    backfill: false,
    bodyHash: "h",
    contentPath: "content/a/b/index",
    lint: [],
    ...over,
  };
}

describe("shardFeedByMonth", () => {
  it("groups by YYYY-MM of first_seen_at", () => {
    const shards = shardFeedByMonth([
      post({ id: "1", first_seen_at: "2026-01-15T00:00:00Z" }),
      post({ id: "2", first_seen_at: "2026-01-20T00:00:00Z" }),
      post({ id: "3", first_seen_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(Object.keys(shards).sort()).toEqual(["2026-01", "2026-02"]);
    expect(shards["2026-01"]).toHaveLength(2);
  });
});

describe("buildSearchIndex", () => {
  it("excludes drafts and duplicates and drops body", () => {
    const idx = buildSearchIndex([
      post({ id: "1", title: "keep" }),
      post({ id: "2", draft: true }),
      post({ id: "3", duplicate_of: "1" }),
    ]);
    expect(idx).toHaveLength(1);
    expect(idx[0]).not.toHaveProperty("html");
    expect(idx[0].title).toBe("keep");
  });
});

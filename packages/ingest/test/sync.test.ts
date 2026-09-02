import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockGithubClient, type SearchItemSpec } from "./helpers.js";
import { NullStore } from "../src/r2.js";
import { runSync, type SyncConfig } from "../src/sync.js";
import type { Post } from "@intracloud/schema";

const CONFIG = (outDir: string, now: string): SyncConfig => ({
  outDir,
  aliases: { k8s: "kubernetes" },
  blocklist: { tags: ["spam"], repos: [] },
  now,
  maxSplitDepth: 0,
});

async function feed(outDir: string): Promise<{ posts: Post[] }> {
  return JSON.parse(await readFile(join(outDir, "feed.json"), "utf-8"));
}

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ic-sync-"));
  return () => rm(outDir, { recursive: true, force: true });
});

function md(title: string, body = "hello world", extra = ""): string {
  return `---\nintracloud: 1\ntitle: ${title}\ntags: [k8s, spam, rust]\n${extra}---\n\n${body}`;
}

describe("runSync end to end (mocked github)", () => {
  it("first sync marks posts backfill; feed + state + content written", async () => {
    const items: SearchItemSpec[] = [
      { full_name: "sam/blog", path: "intracloud.md", sha: "s1" },
    ];
    const { client, logger } = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
      blobs: { s1: md("First Post") },
    });
    const summary = await runSync(client, new NullStore(), logger, CONFIG(outDir, "2026-09-02T00:00:00.000Z"));

    expect(summary.fetched).toBe(1);
    const f = await feed(outDir);
    expect(f.posts).toHaveLength(1);
    const p = f.posts[0];
    expect(p.backfill).toBe(true);
    expect(p.author).toBe("sam");
    expect(p.url).toBe("/@sam/blog");
    // tags: k8s→kubernetes, spam blocked, rust kept
    expect(p.tags).toEqual(["kubernetes", "rust"]);
    expect(p.summary).toContain("hello world");

    // content files exist
    const body = await readFile(join(outDir, p.contentPath + ".html"), "utf-8");
    expect(body).toContain("hello world");
    const state = JSON.parse(await readFile(join(outDir, "state.json"), "utf-8"));
    expect(state.posts["sam/blog/intracloud.md"].blob_sha).toBe("s1");
  });

  it("second sync skips unchanged, marks a genuinely-new post non-backfill", async () => {
    // run 1
    let items: SearchItemSpec[] = [
      { full_name: "sam/blog", path: "intracloud.md", sha: "s1" },
    ];
    let mock = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
      blobs: { s1: md("First") },
    });
    await runSync(mock.client, new NullStore(), mock.logger, CONFIG(outDir, "2026-09-02T00:00:00.000Z"));

    // run 2: same post unchanged + a new post in the same repo
    items = [
      { full_name: "sam/blog", path: "intracloud.md", sha: "s1" },
      { full_name: "sam/blog", path: "posts/new/intracloud.md", sha: "s2" },
    ];
    mock = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
      blobs: { s1: md("First"), s2: md("Second") },
    });
    const summary = await runSync(mock.client, new NullStore(), mock.logger, CONFIG(outDir, "2026-09-03T00:00:00.000Z"));

    expect(summary.skipped).toBe(1);
    expect(summary.fetched).toBe(1);
    const f = await feed(outDir);
    const byId = new Map(f.posts.map((p) => [p.id, p]));
    expect(byId.get("sam/blog/intracloud.md")!.backfill).toBe(true);
    expect(byId.get("sam/blog/posts/new/intracloud.md")!.backfill).toBe(false);
    // first_seen_at of the unchanged post is preserved from run 1
    expect(byId.get("sam/blog/intracloud.md")!.first_seen_at).toBe("2026-09-02T00:00:00.000Z");
  });

  it("marks cross-owner duplicates", async () => {
    const items: SearchItemSpec[] = [
      { full_name: "amy/a", path: "intracloud.md", sha: "x1" },
      { full_name: "bob/b", path: "intracloud.md", sha: "x2" },
    ];
    const same = md("Shared", "the exact same body text here");
    const { client, logger } = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
      blobs: { x1: same, x2: same },
    });
    const summary = await runSync(client, new NullStore(), logger, CONFIG(outDir, "2026-09-02T00:00:00.000Z"));
    expect(summary.duplicates).toBe(1);
    const f = await feed(outDir);
    const dups = f.posts.filter((p) => p.duplicate_of);
    expect(dups).toHaveLength(1);
  });

  it("skips a draft and continues past a malformed post", async () => {
    const items: SearchItemSpec[] = [
      { full_name: "sam/blog", path: "intracloud.md", sha: "ok" },
      { full_name: "sam/blog", path: "d/intracloud.md", sha: "draft" },
      { full_name: "sam/blog", path: "bad/intracloud.md", sha: "bad" },
    ];
    const { client, logger } = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
      blobs: {
        ok: md("Good"),
        draft: md("Draft", "x", "draft: true\n"),
        bad: "no frontmatter at all",
      },
    });
    const summary = await runSync(client, new NullStore(), logger, CONFIG(outDir, "2026-09-02T00:00:00.000Z"));
    expect(summary.fetched).toBe(1);
    expect(summary.failed).toBe(1); // the malformed one
    const f = await feed(outDir);
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].title).toBe("Good");
  });
});

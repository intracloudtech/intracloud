import { describe, it, expect } from "vitest";
import { discover } from "../src/discover.js";
import { mockGithubClient, type SearchItemSpec } from "./helpers.js";

function repoFiles(n: number, prefix: string): SearchItemSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `${prefix}${i}/blog`,
    path: "intracloud.md",
    sha: `sha-${prefix}-${i}`,
  }));
}

describe("discover", () => {
  it("dedupes across pages and slices, keyed owner/repo/path", async () => {
    const items: SearchItemSpec[] = [
      { full_name: "sam/blog", path: "intracloud.md", sha: "a" },
      { full_name: "sam/blog", path: "posts/x/intracloud.md", sha: "b" },
      { full_name: "amy/notes", path: "intracloud.md", sha: "c" },
    ];
    // return the same items for every slice/filename → heavy duplication
    const { client, logger } = mockGithubClient({
      search: ({ filename }) =>
        filename === "intracloud.md" ? items : [],
    });
    const found = await discover(client, logger);
    expect(found.size).toBe(3);
    expect([...found.keys()].sort()).toEqual([
      "amy/notes/intracloud.md",
      "sam/blog/intracloud.md",
      "sam/blog/posts/x/intracloud.md",
    ]);
  });

  it("breaks early when a page returns fewer than 100 items", async () => {
    // put 150 items in ONE slice so page1=100, page2=50 (break), no page3
    const many = repoFiles(150, "r");
    const { client, logger, calls } = mockGithubClient({
      search: ({ filename, slice }) =>
        filename === "intracloud.md" && slice === "size:<=999" ? many : [],
    });
    await discover(client, logger);
    // for the <=999 slice we should have fetched exactly page 1 and 2
    const searchCalls = calls.filter((c) => c.startsWith("/search/code"));
    const slicePages = searchCalls.filter(
      (c) =>
        c.includes(encodeURIComponent("size:<=999")) &&
        c.includes(encodeURIComponent("filename:intracloud.md ")),
    );
    expect(slicePages).toHaveLength(2);
  });

  it("detects saturation and splits the slice", async () => {
    // 1000 identical-slice items → all 10 pages full → saturation → split
    const saturated = repoFiles(1000, "s");
    const { client, logger, lines } = mockGithubClient({
      search: ({ filename, slice }) =>
        filename === "intracloud.md" && slice === "size:>=12001"
          ? saturated
          : [],
    });
    await discover(client, logger, { maxSplitDepth: 1 });
    expect(lines.join("\n")).toMatch(/slice saturated; splitting/);
  });

  it("skips blocklisted repos", async () => {
    const items: SearchItemSpec[] = [
      { full_name: "good/blog", path: "intracloud.md", sha: "a" },
      { full_name: "spammer/spam-blog", path: "intracloud.md", sha: "b" },
    ];
    const { client, logger } = mockGithubClient({
      search: ({ filename }) => (filename === "intracloud.md" ? items : []),
    });
    const found = await discover(client, logger, {
      blockedRepos: ["spammer/spam-blog"],
    });
    expect(found.has("good/blog/intracloud.md")).toBe(true);
    expect(found.has("spammer/spam-blog/intracloud.md")).toBe(false);
  });

  it("indexes .mdx files too", async () => {
    const { client, logger } = mockGithubClient({
      search: ({ filename }) =>
        filename === "intracloud.mdx"
          ? [{ full_name: "sam/blog", path: "intracloud.mdx", sha: "z" }]
          : [],
    });
    const found = await discover(client, logger);
    const f = found.get("sam/blog/intracloud.mdx");
    expect(f?.isMdx).toBe(true);
  });
});

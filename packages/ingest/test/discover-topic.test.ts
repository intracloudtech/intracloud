import { describe, it, expect } from "vitest";
import { discoverByTopic } from "../src/discover-topic.js";
import { mockGithubClient } from "./helpers.js";

describe("discoverByTopic", () => {
  it("finds intracloud files at any depth across topic repos", async () => {
    const { client, logger } = mockGithubClient({
      topicRepos: () => [
        {
          full_name: "sam/blog",
          files: [
            { path: "intracloud.md", sha: "a" },
            { path: "posts/deep/nested/intracloud.md", sha: "b" },
            { path: "README.md", sha: "ignore" }, // not an intracloud file
          ],
        },
        { full_name: "amy/notes", files: [{ path: "intracloud.mdx", sha: "c" }] },
      ],
    });
    const found = await discoverByTopic(client, logger);
    expect([...found.keys()].sort()).toEqual([
      "amy/notes/intracloud.mdx",
      "sam/blog/intracloud.md",
      "sam/blog/posts/deep/nested/intracloud.md",
    ]);
    // blob sha + mdx flag carried through
    expect(found.get("amy/notes/intracloud.mdx")!.isMdx).toBe(true);
    expect(found.get("sam/blog/intracloud.md")!.sha).toBe("a");
  });

  it("skips blocklisted repos", async () => {
    const { client, logger } = mockGithubClient({
      topicRepos: () => [
        { full_name: "good/blog", files: [{ path: "intracloud.md", sha: "a" }] },
        { full_name: "spammer/x", files: [{ path: "intracloud.md", sha: "b" }] },
      ],
    });
    const found = await discoverByTopic(client, logger, {
      blockedRepos: ["spammer/x"],
    });
    expect(found.has("good/blog/intracloud.md")).toBe(true);
    expect(found.has("spammer/x/intracloud.md")).toBe(false);
  });

  it("returns nothing when no repos carry the topic", async () => {
    const { client, logger } = mockGithubClient({ topicRepos: () => [] });
    const found = await discoverByTopic(client, logger);
    expect(found.size).toBe(0);
  });
});

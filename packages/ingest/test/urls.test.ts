import { describe, it, expect } from "vitest";
import {
  postUrl,
  rawUrl,
  stripPostFilename,
  resolveRelativePostLink,
  tagUrl,
  RESERVED_SEGMENTS,
} from "@intracloud/schema";

describe("stripPostFilename", () => {
  it("strips intracloud.md at root", () => {
    expect(stripPostFilename("intracloud.md")).toBe("");
  });
  it("strips nested intracloud.md", () => {
    expect(stripPostFilename("posts/hello/intracloud.md")).toBe("posts/hello");
  });
  it("strips intracloud.mdx", () => {
    expect(stripPostFilename("a/b/intracloud.mdx")).toBe("a/b");
  });
});

describe("postUrl", () => {
  it("maps a root file to /@owner/repo", () => {
    expect(postUrl("sam", "blog", "intracloud.md")).toBe("/@sam/blog");
  });
  it("maps a nested file", () => {
    expect(postUrl("sam", "blog", "posts/hello-world/intracloud.md")).toBe(
      "/@sam/blog/posts/hello-world",
    );
  });
  it("maps a deeply nested file", () => {
    expect(postUrl("sam", "notes", "2026/rust-gc/intracloud.md")).toBe(
      "/@sam/notes/2026/rust-gc",
    );
  });
  it("has no trailing slash", () => {
    expect(postUrl("a", "b", "c/intracloud.md").endsWith("/")).toBe(false);
  });
  it("passes reserved words through in later segments unharmed", () => {
    // reserved words only matter as the FIRST segment of the whole site;
    // owners are prefixed with @ so they can never collide.
    expect(postUrl("api", "t", "search/intracloud.md")).toBe("/@api/t/search");
  });
});

describe("rawUrl", () => {
  it("appends .md", () => {
    expect(rawUrl("sam", "blog", "posts/hi/intracloud.md")).toBe(
      "/@sam/blog/posts/hi.md",
    );
  });
  it("works at repo root", () => {
    expect(rawUrl("sam", "blog", "intracloud.md")).toBe("/@sam/blog.md");
  });
});

describe("resolveRelativePostLink", () => {
  const owner = "sam";
  const repo = "notes";
  const from = "2026/postmortem/intracloud.md";

  it("resolves a sibling directory link", () => {
    expect(resolveRelativePostLink(owner, repo, from, "../rust-gc/")).toBe(
      "/@sam/notes/2026/rust-gc",
    );
  });
  it("resolves a link to a sibling intracloud.md", () => {
    expect(
      resolveRelativePostLink(owner, repo, from, "../rust-gc/intracloud.md"),
    ).toBe("/@sam/notes/2026/rust-gc");
  });
  it("preserves a fragment", () => {
    expect(
      resolveRelativePostLink(owner, repo, from, "../rust-gc/#section"),
    ).toBe("/@sam/notes/2026/rust-gc#section");
  });
  it("returns null for absolute URLs", () => {
    expect(
      resolveRelativePostLink(owner, repo, from, "https://x.com"),
    ).toBeNull();
  });
  it("returns null for repo-absolute paths", () => {
    expect(resolveRelativePostLink(owner, repo, from, "/other")).toBeNull();
  });
  it("returns null for bare anchors", () => {
    expect(resolveRelativePostLink(owner, repo, from, "#top")).toBeNull();
  });
  it("returns null when the link escapes the repo root", () => {
    expect(
      resolveRelativePostLink(owner, repo, from, "../../../../etc"),
    ).toBeNull();
  });
});

describe("reserved segments", () => {
  it("includes the expected words", () => {
    for (const w of ["search", "feed", "rss", "about", "api", "t", "settings", "_astro"]) {
      expect(RESERVED_SEGMENTS).toContain(w);
    }
  });
});

describe("tagUrl", () => {
  it("builds a tag route", () => {
    expect(tagUrl("rust")).toBe("/t/rust");
  });
});

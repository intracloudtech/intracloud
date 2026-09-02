import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@intracloud/schema";

describe("parseFrontmatter", () => {
  it("accepts the minimal valid frontmatter", () => {
    const r = parseFrontmatter({ intracloud: 1, title: "Hello" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.intracloud).toBe(1);
      expect(r.data.title).toBe("Hello");
      expect(r.warnings).toHaveLength(0);
    }
  });

  it("fails closed when intracloud is missing", () => {
    const r = parseFrontmatter({ title: "Hello" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/intracloud/);
  });

  it("fails closed when title is missing", () => {
    const r = parseFrontmatter({ intracloud: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/title/);
  });

  it("rejects an empty title", () => {
    const r = parseFrontmatter({ intracloud: 1, title: "   " });
    expect(r.ok).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const r = parseFrontmatter({ intracloud: 2, title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/schema version/);
  });

  it("accepts intracloud as the string \"1\"", () => {
    const r = parseFrontmatter({ intracloud: "1", title: "x" });
    expect(r.ok).toBe(true);
  });

  it("coerces a numeric title to string", () => {
    const r = parseFrontmatter({ intracloud: 1, title: 2026 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.title).toBe("2026");
  });

  it("warns on unknown keys but passes them through", () => {
    const r = parseFrontmatter({ intracloud: 1, title: "x", wat: "huh" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.join()).toMatch(/unknown frontmatter key: wat/);
      expect(r.data.wat).toBe("huh");
    }
  });

  it("treats malformed YAML / non-object as a hard failure", () => {
    expect(parseFrontmatter(undefined).ok).toBe(false);
    expect(parseFrontmatter(null).ok).toBe(false);
    expect(parseFrontmatter("just a string").ok).toBe(false);
    expect(parseFrontmatter([1, 2, 3]).ok).toBe(false);
  });

  it("treats an empty object (empty frontmatter) as a hard failure", () => {
    const r = parseFrontmatter({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("wraps a single string tag into an array", () => {
    const r = parseFrontmatter({ intracloud: 1, title: "x", tags: "solo" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.tags).toEqual(["solo"]);
  });

  it("warns and drops a non-array, non-string tags value", () => {
    const r = parseFrontmatter({ intracloud: 1, title: "x", tags: 42 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.tags).toBeUndefined();
      expect(r.warnings.join()).toMatch(/tags/);
    }
  });

  it("warns and drops an invalid canonical URL", () => {
    const r = parseFrontmatter({
      intracloud: 1,
      title: "x",
      canonical: "not a url",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.canonical).toBeUndefined();
      expect(r.warnings.join()).toMatch(/canonical/);
    }
  });

  it("keeps a valid canonical URL", () => {
    const r = parseFrontmatter({
      intracloud: 1,
      title: "x",
      canonical: "https://example.com/post",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.canonical).toBe("https://example.com/post");
  });

  it("parses draft from string and boolean", () => {
    const a = parseFrontmatter({ intracloud: 1, title: "x", draft: true });
    const b = parseFrontmatter({ intracloud: 1, title: "x", draft: "true" });
    expect(a.ok && a.data.draft).toBe(true);
    expect(b.ok && b.data.draft).toBe(true);
  });
});

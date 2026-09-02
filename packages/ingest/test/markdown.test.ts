import { describe, it, expect } from "vitest";
import {
  parseFile,
  parseMdast,
  plainText,
  deriveSummary,
  bodyHash,
} from "../src/markdown.js";

const FM = "---\nintracloud: 1\ntitle: Hello\n---\n";

describe("parseFile", () => {
  it("parses a valid file", () => {
    const r = parseFile(FM + "Body text here.");
    expect(r.ok).toBe(true);
    expect(r.frontmatter?.title).toBe("Hello");
    expect(r.body.trim()).toBe("Body text here.");
  });

  it("fails on an empty file", () => {
    const r = parseFile("");
    expect(r.ok).toBe(false);
  });

  it("fails on a frontmatter-only file missing required fields", () => {
    const r = parseFile("---\nsummary: hi\n---\n");
    expect(r.ok).toBe(false);
  });

  it("passes on a frontmatter-only file with required fields (empty body)", () => {
    const r = parseFile(FM);
    expect(r.ok).toBe(true);
    expect(r.body.trim()).toBe("");
  });

  it("fails on malformed YAML", () => {
    const r = parseFile("---\nintracloud: 1\ntitle: [unclosed\n---\nx");
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/YAML|malformed/i);
  });
});

describe("plainText + summary", () => {
  it("extracts text from markdown", () => {
    const t = plainText(parseMdast("# Title\n\nHello **world** and `code`."));
    expect(t).toContain("Hello");
    expect(t).toContain("world");
    expect(t).toContain("code");
  });
  it("derives a truncated summary with ellipsis", () => {
    const long = "word ".repeat(100);
    const s = deriveSummary(plainText(parseMdast(long)));
    expect(s.length).toBeLessThanOrEqual(201);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("bodyHash (dedup key)", () => {
  it("is stable across whitespace/casing differences", () => {
    const a = bodyHash("Hello   World");
    const b = bodyHash("hello world");
    expect(a).toBe(b);
  });
  it("differs for different content", () => {
    expect(bodyHash("a")).not.toBe(bodyHash("b"));
  });
});

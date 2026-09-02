import { describe, it, expect } from "vitest";
import { norm, normalizeTags } from "@intracloud/schema";

describe("norm (single tag)", () => {
  it("lowercases and trims", () => {
    expect(norm("  RUST  ")).toBe("rust");
  });
  it("collapses whitespace and underscores to a single hyphen", () => {
    expect(norm("machine   learning")).toBe("machine-learning");
    expect(norm("deep_learning")).toBe("deep-learning");
  });
  it("strips emoji but keeps unicode letters", () => {
    expect(norm("café☕")).toBe("café");
    expect(norm("日本語")).toBe("日本語");
  });
  it("collapses repeated hyphens and trims leading/trailing", () => {
    expect(norm("--a--b--")).toBe("a-b");
  });
  it("truncates to 30 chars", () => {
    expect(norm("a".repeat(50)).length).toBe(30);
  });
  it("reduces a pure-emoji tag to empty", () => {
    expect(norm("🎉🎉")).toBe("");
  });
});

describe("normalizeTags (list)", () => {
  it("dedupes after normalization", () => {
    expect(normalizeTags(["Rust", "rust", "RUST"])).toEqual(["rust"]);
  });
  it("drops empties", () => {
    expect(normalizeTags(["ok", "🎉", "  "])).toEqual(["ok"]);
  });
  it("caps at 5 by default", () => {
    expect(normalizeTags(["a", "b", "c", "d", "e", "f", "g"])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
  it("respects a custom cap", () => {
    expect(normalizeTags(["a", "b", "c"], { cap: 2 })).toEqual(["a", "b"]);
  });
  it("applies aliases", () => {
    expect(
      normalizeTags(["k8s", "js"], {
        aliases: { k8s: "kubernetes", js: "javascript" },
      }),
    ).toEqual(["kubernetes", "javascript"]);
  });
  it("dedupes when an alias collides with an existing tag", () => {
    expect(
      normalizeTags(["kubernetes", "k8s"], { aliases: { k8s: "kubernetes" } }),
    ).toEqual(["kubernetes"]);
  });
  it("drops blocklisted tags", () => {
    expect(normalizeTags(["spam", "rust"], { blocklist: ["spam"] })).toEqual([
      "rust",
    ]);
  });
  it("blocks a tag reached via an alias", () => {
    expect(
      normalizeTags(["js"], { aliases: { js: "javascript" }, blocklist: ["javascript"] }),
    ).toEqual([]);
  });
  it("handles undefined input", () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

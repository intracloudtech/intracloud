import { describe, it, expect } from "vitest";
import {
  parseSlice,
  rangeToQualifier,
  splitRange,
  rangesDisjoint,
  defaultRanges,
} from "../src/slices.js";

describe("slice parsing", () => {
  it("parses the default slices", () => {
    expect(parseSlice("size:<1000")).toEqual({ min: 0, max: 999 });
    expect(parseSlice("size:1000..3000")).toEqual({ min: 1000, max: 3000 });
    expect(parseSlice("size:>12000")).toEqual({ min: 12001, max: null });
  });
  it("round-trips through a qualifier", () => {
    expect(rangeToQualifier({ min: 1000, max: 3000 })).toBe("size:1000..3000");
    expect(rangeToQualifier({ min: 12001, max: null })).toBe("size:>=12001");
    expect(rangeToQualifier({ min: 0, max: 999 })).toBe("size:<=999");
  });
});

describe("default slices are disjoint and non-touching", () => {
  it("no two default ranges overlap", () => {
    expect(rangesDisjoint(defaultRanges())).toBe(true);
  });
  it("boundaries do not touch (3000 belongs to exactly one slice)", () => {
    const ranges = defaultRanges();
    const containing = ranges.filter(
      (r) => 3000 >= r.min && 3000 <= (r.max ?? Infinity),
    );
    expect(containing).toHaveLength(1);
  });
  it("every byte size lands in exactly one slice", () => {
    const ranges = defaultRanges();
    for (const size of [0, 999, 1000, 3000, 3001, 6000, 6001, 12000, 12001, 99999]) {
      const hits = ranges.filter(
        (r) => size >= r.min && size <= (r.max ?? Infinity),
      );
      expect(hits, `size ${size}`).toHaveLength(1);
    }
  });
});

describe("splitRange", () => {
  it("splits a bounded range into disjoint halves", () => {
    const [a, b] = splitRange({ min: 1000, max: 3000 });
    expect(a).toEqual({ min: 1000, max: 2000 });
    expect(b).toEqual({ min: 2001, max: 3000 });
    expect(rangesDisjoint([a, b])).toBe(true);
  });
  it("splits an unbounded range", () => {
    const [a, b] = splitRange({ min: 12001, max: null });
    expect(a.min).toBe(12001);
    expect(b.max).toBeNull();
    expect(rangesDisjoint([a, b])).toBe(true);
    expect(a.max! + 1).toBe(b.min);
  });
});

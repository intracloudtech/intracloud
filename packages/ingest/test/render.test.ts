import { describe, it, expect } from "vitest";
import { renderHtml } from "../src/render.js";

describe("renderHtml", () => {
  it("syntax-highlights a fenced code block with class-based tokens", async () => {
    const html = await renderHtml("```js\nconst x = 1;\n```");
    expect(html).toContain("hljs");
    expect(html).toMatch(/hljs-keyword|hljs-title|hljs-number/);
    // no inline styles — highlighting is class-based
    expect(html).not.toMatch(/style="/);
  });

  it("does not crash on an unknown language", async () => {
    const html = await renderHtml("```notalang\nsome text\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("some text");
  });

  it("auto-detects and highlights a fence with no language", async () => {
    const html = await renderHtml("```\nfunction greet() { return 42; }\n```");
    expect(html).toContain("greet");
    expect(html).toContain("hljs"); // auto-detection colors bare fences too
  });

  it("still strips scripts and handlers from raw HTML", async () => {
    const html = await renderHtml(`ok <script>alert(1)</script> <b onclick="x()">y</b>`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
  });

  it("renders normal markdown to html", async () => {
    const html = await renderHtml("# Title\n\nHello **world**.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
  });
});

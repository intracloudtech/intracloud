import { describe, it, expect } from "vitest";
import {
  transformBody,
  resolveAssetPath,
  type TransformDeps,
} from "../src/transform.js";

function deps(over: Partial<TransformDeps> = {}): TransformDeps {
  return {
    owner: "sam",
    repo: "blog",
    postPath: "posts/hello/intracloud.md",
    fetchAsset: async ({ url, repoPath }) => {
      // any known path returns bytes; a path containing "missing" 404s
      const key = url ?? repoPath ?? "";
      if (key.includes("missing")) return null;
      return Buffer.from("IMGBYTES:" + key);
    },
    processImage: async (bytes) => ({
      url: `https://cdn.intracloud.tech/i/${Buffer.from(bytes)
        .toString("hex")
        .slice(0, 16)}.webp`,
    }),
    ...over,
  };
}

describe("resolveAssetPath", () => {
  it("resolves a relative sibling", () => {
    expect(resolveAssetPath("posts/hello/intracloud.md", "./cover.png")).toBe(
      "posts/hello/cover.png",
    );
  });
  it("resolves a parent reference", () => {
    expect(resolveAssetPath("posts/hello/intracloud.md", "../shared/a.png")).toBe(
      "posts/shared/a.png",
    );
  });
  it("returns null when escaping the repo", () => {
    expect(resolveAssetPath("intracloud.md", "../../x.png")).toBeNull();
  });
});

describe("image rewriter", () => {
  it("rehosts a relative image", async () => {
    const r = await transformBody("![alt](./cover.png)", deps());
    expect(r.markdown).toMatch(/cdn\.intracloud\.tech\/i\/[0-9a-f]{16}\.webp/);
    expect(r.imagesUploaded).toBe(1);
  });

  it("rehosts an absolute image too (no passthrough)", async () => {
    const r = await transformBody("![](https://evil.example/pixel.png)", deps());
    expect(r.markdown).toContain("cdn.intracloud.tech");
    expect(r.markdown).not.toContain("evil.example");
  });

  it("leaves data: URIs untouched", async () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const r = await transformBody(`![](${src})`, deps());
    expect(r.markdown).toContain("data:image/png;base64");
    expect(r.imagesUploaded).toBe(0);
  });

  it("records a lint warning when a source 404s", async () => {
    const r = await transformBody("![](./missing.png)", deps());
    expect(r.lint.some((l) => l.code === "image-404")).toBe(true);
    expect(r.markdown).toContain("./missing.png"); // left as-is
  });

  it("rehosts <img> inside raw HTML", async () => {
    const r = await transformBody(`<img src="./pic.png" alt="x">`, deps());
    expect(r.markdown).toContain("cdn.intracloud.tech");
    expect(r.markdown).not.toContain("./pic.png");
  });

  it("dedupes identical srcs via memo (one upload)", async () => {
    let uploads = 0;
    const r = await transformBody(
      "![](./a.png)\n\n![](./a.png)",
      deps({
        processImage: async (bytes) => {
          uploads++;
          return { url: "https://cdn.intracloud.tech/i/same.webp" };
        },
      }),
    );
    expect(uploads).toBe(1);
    expect(r.imagesUploaded).toBe(1);
  });

  it("honours the asset cap", async () => {
    const r = await transformBody(
      "![](./a.png) ![](./b.png) ![](./c.png)",
      deps({ maxAssets: 1 }),
    );
    expect(r.imagesUploaded).toBe(1);
    expect(r.lint.some((l) => l.code === "asset-cap")).toBe(true);
  });
});

describe("link rewriter", () => {
  it("rewrites a relative inter-post link", async () => {
    const r = await transformBody(
      "see [rust](../rust-gc/) for more",
      deps({ postPath: "notes/pm/intracloud.md", repo: "notes" }),
    );
    expect(r.markdown).toContain("/@sam/notes/notes/rust-gc");
  });
  it("leaves absolute links alone", async () => {
    const r = await transformBody("[x](https://example.com)", deps());
    expect(r.markdown).toContain("https://example.com");
  });
});

describe("sanitize", () => {
  it("strips <script> tags", async () => {
    const r = await transformBody(
      `<div>hi<script>alert(1)</script></div>`,
      deps(),
    );
    expect(r.markdown).not.toMatch(/<script/i);
    expect(r.markdown).not.toContain("alert(1)");
  });
  it("strips event handler attributes", async () => {
    const r = await transformBody(`<img src="./x.png" onerror="steal()">`, deps());
    expect(r.markdown).not.toMatch(/onerror/i);
  });
  it("neutralizes javascript: hrefs", async () => {
    const r = await transformBody(`<a href="javascript:evil()">x</a>`, deps());
    expect(r.markdown).not.toMatch(/javascript:/i);
  });
});

import { visit, SKIP } from "unist-util-visit";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { visit as visitHast } from "unist-util-visit";
import type { Root, Image, Link, Html } from "mdast";
import type { LintWarning } from "@intracloud/schema";
import { resolveRelativePostLink, stripPostFilename } from "@intracloud/schema";
import { parseMdast, serializeMdast } from "./markdown.js";
import { MAX_ASSETS_PER_POST } from "./config.js";

export interface ImageResult {
  url: string;
}

export interface TransformDeps {
  owner: string;
  repo: string;
  /** full path to the post's intracloud.md within the repo */
  postPath: string;
  /** fetch raw bytes for an asset; return null if unfetchable / 404. */
  fetchAsset: (spec: { url?: string; repoPath?: string }) => Promise<Buffer | null>;
  /** convert → WebP → hash → upload; return null when skipped (too big/fail). */
  processImage: (bytes: Buffer, srcHint: string) => Promise<ImageResult | null>;
  maxAssets?: number;
}

export interface TransformResult {
  markdown: string;
  lint: LintWarning[];
  imagesUploaded: number;
}

interface Ctx {
  deps: TransformDeps;
  lint: LintWarning[];
  uploaded: number;
  maxAssets: number;
  /** memo so the same src within a post is fetched/uploaded once. */
  memo: Map<string, string | null>;
}

/** Resolve a relative repo path against the post's directory. Null if it escapes. */
export function resolveAssetPath(postPath: string, src: string): string | null {
  const dir = stripPostFilename(postPath); // post directory
  const segs = dir ? dir.split("/") : [];
  for (const part of src.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length === 0) return null;
      segs.pop();
    } else segs.push(part);
  }
  return segs.join("/");
}

type SrcKind =
  | { kind: "data" }
  | { kind: "absolute"; url: string }
  | { kind: "repo"; repoPath: string }
  | { kind: "skip" };

function classifySrc(postPath: string, src: string): SrcKind {
  if (!src) return { kind: "skip" };
  if (src.startsWith("data:")) return { kind: "data" };
  if (/^https?:\/\//i.test(src)) return { kind: "absolute", url: src };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return { kind: "skip" }; // mailto:, etc.
  if (src.startsWith("//")) return { kind: "absolute", url: "https:" + src };
  const repoPath = src.startsWith("/")
    ? src.slice(1)
    : resolveAssetPath(postPath, src);
  if (repoPath === null) return { kind: "skip" };
  return { kind: "repo", repoPath };
}

/**
 * Rehost a single image src. Returns the new CDN url, or null to keep the
 * original. Memoized per-post. Data URIs and unresolvable schemes are left
 * as-is (returned via memo as null → caller keeps original).
 */
async function rehost(src: string, ctx: Ctx): Promise<string | null> {
  if (ctx.memo.has(src)) return ctx.memo.get(src)!;

  const cls = classifySrc(ctx.deps.postPath, src);
  if (cls.kind === "data" || cls.kind === "skip") {
    ctx.memo.set(src, null);
    return null;
  }

  if (ctx.uploaded >= ctx.maxAssets) {
    ctx.lint.push({
      code: "asset-cap",
      message: `asset cap (${ctx.maxAssets}) reached; not rehosting ${src}`,
    });
    ctx.memo.set(src, null);
    return null;
  }

  let bytes: Buffer | null;
  try {
    bytes =
      cls.kind === "absolute"
        ? await ctx.deps.fetchAsset({ url: cls.url })
        : await ctx.deps.fetchAsset({ repoPath: cls.repoPath });
  } catch {
    bytes = null;
  }

  if (!bytes) {
    ctx.lint.push({ code: "image-404", message: `image source unreachable: ${src}` });
    ctx.memo.set(src, null);
    return null;
  }

  const result = await ctx.deps.processImage(bytes, src);
  if (!result) {
    ctx.lint.push({ code: "image-skip", message: `image skipped: ${src}` });
    ctx.memo.set(src, null);
    return null;
  }
  ctx.uploaded++;
  ctx.memo.set(src, result.url);
  return result.url;
}

/** Sanitize + rewrite a raw HTML fragment (strip scripts/handlers, rehost img). */
async function transformHtml(value: string, ctx: Ctx): Promise<string> {
  const tree = fromHtml(value, { fragment: true });
  const imgJobs: Array<{ node: any; src: string }> = [];

  visitHast(tree, "element", (node: any, index, parent: any) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === "script" || tag === "style") {
      // drop it entirely
      if (parent && typeof index === "number") {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    }
    // strip event-handler + javascript: attributes
    if (node.properties) {
      for (const key of Object.keys(node.properties)) {
        if (/^on/i.test(key)) delete node.properties[key];
      }
      // javascript: hrefs
      const href = node.properties.href;
      if (typeof href === "string" && /^\s*javascript:/i.test(href)) {
        delete node.properties.href;
      }
      const rel = node.properties.href;
      if (tag === "a" && typeof rel === "string") {
        const rewritten = resolveRelativePostLink(
          ctx.deps.owner,
          ctx.deps.repo,
          ctx.deps.postPath,
          rel,
        );
        if (rewritten) node.properties.href = rewritten;
      }
    }
    if (tag === "img" && typeof node.properties?.src === "string") {
      imgJobs.push({ node, src: node.properties.src });
    }
    return undefined;
  });

  for (const job of imgJobs) {
    const url = await rehost(job.src, ctx);
    if (url) job.node.properties.src = url;
  }

  return toHtml(tree);
}

/**
 * Phase 4 — the single transform pass over one post body.
 * Rehosts images (mdast + raw <img>), rewrites relative inter-post links,
 * sanitizes raw HTML. Tags are normalized separately (they need aliases).
 */
export async function transformBody(
  body: string,
  deps: TransformDeps,
): Promise<TransformResult> {
  const tree = parseMdast(body);
  const ctx: Ctx = {
    deps,
    lint: [],
    uploaded: 0,
    maxAssets: deps.maxAssets ?? MAX_ASSETS_PER_POST,
    memo: new Map(),
  };

  const images: Image[] = [];
  const links: Link[] = [];
  const htmls: Html[] = [];

  visit(tree, (node) => {
    if (node.type === "image") images.push(node as Image);
    else if (node.type === "link") links.push(node as Link);
    else if (node.type === "html") htmls.push(node as Html);
  });

  // links (sync)
  for (const link of links) {
    const rewritten = resolveRelativePostLink(
      deps.owner,
      deps.repo,
      deps.postPath,
      link.url,
    );
    if (rewritten) link.url = rewritten;
  }

  // images (async)
  for (const img of images) {
    const url = await rehost(img.url, ctx);
    if (url) img.url = url;
  }

  // raw html nodes (async)
  for (const html of htmls) {
    html.value = await transformHtml(html.value, ctx);
  }

  return {
    markdown: serializeMdast(tree),
    lint: ctx.lint,
    imagesUploaded: ctx.uploaded,
  };
}

/** Rehost a single cover image (frontmatter). Returns new url or null. */
export async function rehostCover(
  src: string,
  deps: TransformDeps,
): Promise<{ url: string | null; lint: LintWarning[] }> {
  const ctx: Ctx = {
    deps,
    lint: [],
    uploaded: 0,
    maxAssets: deps.maxAssets ?? MAX_ASSETS_PER_POST,
    memo: new Map(),
  };
  const url = await rehost(src, ctx);
  return { url, lint: ctx.lint };
}

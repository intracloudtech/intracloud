import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { visit } from "unist-util-visit";
import { createHash } from "node:crypto";
import { parseFrontmatter, type Frontmatter } from "@intracloud/schema";
import type { Root } from "mdast";

export interface ParsedFile {
  ok: boolean;
  frontmatter?: Frontmatter;
  /** markdown body with frontmatter removed */
  body: string;
  errors: string[];
  warnings: string[];
}

/** Split + validate a full intracloud.md file. Never throws. */
export function parseFile(content: string): ParsedFile {
  let gm: matter.GrayMatterFile<string>;
  try {
    gm = matter(content);
  } catch (e) {
    return {
      ok: false,
      body: "",
      errors: [`malformed YAML frontmatter: ${(e as Error).message}`],
      warnings: [],
    };
  }

  // A file with no frontmatter block yields data === {} → fails required-field
  // checks (which is the desired "empty file" / "frontmatter-only" behaviour).
  const parsed = parseFrontmatter(gm.data);
  if (!parsed.ok) {
    return {
      ok: false,
      body: gm.content,
      errors: parsed.errors,
      warnings: parsed.warnings,
    };
  }
  return {
    ok: true,
    frontmatter: parsed.data,
    body: gm.content,
    errors: [],
    warnings: parsed.warnings,
  };
}

export function parseMdast(body: string): Root {
  return fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

export function serializeMdast(tree: Root): string {
  return toMarkdown(tree, {
    bullet: "-",
    fences: true,
    rule: "-",
    extensions: [gfmToMarkdown()],
  });
}

/** Flatten a body to plain text (for summaries and dedup hashing). */
export function plainText(tree: Root): string {
  const parts: string[] = [];
  visit(tree, (node: any) => {
    if (node.type === "text" || node.type === "inlineCode") {
      parts.push(node.value);
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Derive a ~200 char summary from body text when the author gave none. */
export function deriveSummary(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** Stable hash of normalized body text — the dedup key across owners. */
export function bodyHash(text: string): string {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

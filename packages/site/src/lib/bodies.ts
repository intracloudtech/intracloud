import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Post } from "@intracloud/schema";
import { DATA_DIR } from "./paths.js";

export function readBodyHtml(post: Post): string {
  const path = resolve(DATA_DIR, post.contentPath + ".html");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function readBodyMarkdown(post: Post): string {
  const path = resolve(DATA_DIR, post.contentPath + ".md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

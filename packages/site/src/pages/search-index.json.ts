import type { APIRoute } from "astro";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getCollection } from "astro:content";
import type { Post } from "@intracloud/schema";
import { live } from "../lib/rank.js";
import { DATA_DIR } from "../lib/paths.js";

/**
 * The client search index (title, summary, tags, author, url). No body text.
 * Prefer the ingest-built search-index.json; fall back to deriving it from the
 * collection so the route never 404s.
 */
export const GET: APIRoute = async () => {
  const path = resolve(DATA_DIR, "search-index.json");
  if (existsSync(path)) {
    return new Response(readFileSync(path, "utf-8"), {
      headers: { "content-type": "application/json" },
    });
  }
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  const index = live(posts).map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary ?? "",
    tags: p.tags,
    author: p.author,
    url: p.url,
    first_seen_at: p.first_seen_at,
  }));
  return new Response(JSON.stringify(index), {
    headers: { "content-type": "application/json" },
  });
};

import type { APIRoute } from "astro";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getCollection } from "astro:content";
import type { Post } from "@intracloud/schema";
import { DATA_DIR } from "../lib/paths.js";

/**
 * Public JSON API: the full post feed. Consumed by the CLI and any third party.
 * Serves the data-branch feed.json directly when present, else derives it from
 * the content collection so the route never 404s.
 */
export const GET: APIRoute = async () => {
  const path = resolve(DATA_DIR, "feed.json");
  if (existsSync(path)) {
    return new Response(readFileSync(path, "utf-8"), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  return new Response(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      count: posts.length,
      posts,
    }),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
};

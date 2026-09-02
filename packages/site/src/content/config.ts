import { defineCollection } from "astro:content";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PostSchema } from "@intracloud/schema";
import { DATA_DIR } from "../lib/paths.js";

/**
 * Content Layer loader. Reads feed.json from the data branch and validates
 * every entry with the SAME Zod schema ingest used to produce it (Phase 3).
 * Bodies live in content/ files and are read on the post page.
 */
const posts = defineCollection({
  loader: async () => {
    const path = resolve(DATA_DIR, "feed.json");
    if (!existsSync(path)) return [];
    const feed = JSON.parse(readFileSync(path, "utf-8")) as {
      posts: Array<Record<string, unknown>>;
    };
    // Astro requires a string `id` per entry; our post.id already is one.
    return feed.posts.map((p) => ({ ...p, id: p.id as string }));
  },
  schema: PostSchema,
});

export const collections = { posts };

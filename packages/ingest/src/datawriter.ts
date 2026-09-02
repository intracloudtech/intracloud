import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Post } from "@intracloud/schema";
import type { State } from "./state.js";

/** Rendered body for one post, written to the content/ tree. */
export interface PostBody {
  /** e.g. `content/sam/blog/posts/hello` (no extension). */
  contentPath: string;
  markdown: string;
  html: string;
}

export interface WriteInput {
  outDir: string;
  posts: Post[];
  state: State;
  bodies: PostBody[];
  generatedAt: string;
}

const ONE_MB = 1_000_000;

/** Group posts by YYYY-MM of first_seen_at (for sharding a large feed). */
export function shardFeedByMonth(posts: Post[]): Record<string, Post[]> {
  const shards: Record<string, Post[]> = {};
  for (const p of posts) {
    const month = p.first_seen_at.slice(0, 7); // YYYY-MM
    (shards[month] ??= []).push(p);
  }
  return shards;
}

/**
 * A lean, client-facing search index. No body text (spec: title/summary/tags/
 * author only) so the browser payload stays tiny well past 5000 posts.
 */
export function buildSearchIndex(posts: Post[]) {
  return posts
    .filter((p) => !p.draft && !p.duplicate_of)
    .map((p) => ({
      id: p.id,
      title: p.title,
      summary: p.summary ?? "",
      tags: p.tags,
      author: p.author,
      url: p.url,
      first_seen_at: p.first_seen_at,
    }));
}

async function writeJson(path: string, data: unknown): Promise<number> {
  const json = JSON.stringify(data);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, "utf-8");
  return Buffer.byteLength(json);
}

/**
 * Write feed.json, state.json, the content/ tree, and the client search index
 * into `outDir`. Shards feed.json by month if it exceeds ~1 MB. Does NOT touch
 * git — committing/force-pushing the orphan data branch happens in the workflow.
 */
export async function writeData(input: WriteInput): Promise<{ feedBytes: number }> {
  const { outDir } = input;

  // fresh content tree each run so deleted posts genuinely disappear
  await rm(join(outDir, "content"), { recursive: true, force: true });

  const feed = {
    generated_at: input.generatedAt,
    count: input.posts.length,
    posts: input.posts,
  };
  const feedBytes = await writeJson(join(outDir, "feed.json"), feed);

  if (feedBytes > ONE_MB) {
    const shards = shardFeedByMonth(input.posts);
    const months = Object.keys(shards).sort();
    for (const m of months) {
      await writeJson(join(outDir, "feed", `feed-${m}.json`), {
        generated_at: input.generatedAt,
        month: m,
        count: shards[m].length,
        posts: shards[m],
      });
    }
    await writeJson(join(outDir, "feed", "index.json"), { months });
  }

  await writeJson(
    join(outDir, "search-index.json"),
    buildSearchIndex(input.posts),
  );

  await writeJson(join(outDir, "state.json"), input.state);

  for (const body of input.bodies) {
    const base = join(outDir, body.contentPath);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base + ".md", body.markdown, "utf-8");
    await writeFile(base + ".html", body.html, "utf-8");
  }

  return { feedBytes };
}

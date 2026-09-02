import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import type { Post } from "@intracloud/schema";
import { live } from "../lib/rank.js";
import { readBodyMarkdown } from "../lib/bodies.js";

/** Serve raw markdown source at `/@owner/repo/path.md`. */
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  return live(posts).map((p) => ({
    params: { slug: p.url.slice(1) }, // .md is appended by the filename
    props: { id: p.id },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  const post = posts.find((p) => p.id === (props as any).id);
  const md = post ? readBodyMarkdown(post) : "";
  return new Response(md, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};

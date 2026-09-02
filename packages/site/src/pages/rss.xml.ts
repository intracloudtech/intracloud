import type { APIRoute } from "astro";
import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { Post } from "@intracloud/schema";
import { latestFeed } from "../lib/rank.js";
import { SITE_NAME, SITE_DESCRIPTION } from "../lib/constants.js";

export const GET: APIRoute = async (context) => {
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  const items = latestFeed(posts).slice(0, 50);
  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: items.map((p) => ({
      title: p.title,
      description: p.summary ?? "",
      link: p.url,
      pubDate: new Date(p.first_seen_at),
      author: `@${p.author}`,
      categories: p.tags,
    })),
  });
};

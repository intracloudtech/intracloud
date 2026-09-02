import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import type { Post } from "@intracloud/schema";
import { live, authors, reposByAuthor, routableTags } from "../lib/rank.js";

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL("https://intracloud.tech")).origin;
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];

  const paths = new Set<string>(["/", "/search", "/about"]);
  for (const owner of authors(posts)) {
    paths.add(`/@${owner}`);
    for (const g of reposByAuthor(posts, owner)) paths.add(`/@${g.owner}/${g.repo}`);
  }
  for (const p of live(posts)) paths.add(p.url);
  for (const { tag } of routableTags(posts)) paths.add(`/t/${tag}`);

  const urls = [...paths]
    .map((p) => `  <url><loc>${origin}${escapeXml(p)}</loc></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml" } });
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

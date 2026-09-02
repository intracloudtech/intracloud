import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";
import type { Post } from "@intracloud/schema";
import { live } from "../../lib/rank.js";
import { SITE_NAME } from "../../lib/constants.js";

const fontRegular = readFileSync(
  fileURLToPath(new URL("../../../assets/fonts/Tuffy-Regular.ttf", import.meta.url)),
);
const fontBold = readFileSync(
  fileURLToPath(new URL("../../../assets/fonts/Tuffy-Bold.ttf", import.meta.url)),
);

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  return live(posts).map((p) => ({
    params: { slug: p.url.slice(1) },
    props: { id: p.id },
  }));
};

function node(type: string, style: Record<string, unknown>, children: unknown): any {
  return { type, props: { style, children } };
}

export const GET: APIRoute = async ({ props }) => {
  const posts = (await getCollection("posts")).map((e) => e.data) as Post[];
  const post = posts.find((p) => p.id === (props as any).id);
  const title = post?.title ?? SITE_NAME;
  const author = post ? `@${post.author}` : "";

  const tree = node(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "70px",
      backgroundColor: "#0d1117",
      color: "#e6edf3",
      fontFamily: "Tuffy",
    },
    [
      node("div", { fontSize: 34, color: "#58a6ff", fontWeight: 700 }, "☁ Intracloud"),
      node(
        "div",
        { fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: "1000px" },
        title.length > 90 ? title.slice(0, 88) + "…" : title,
      ),
      node("div", { fontSize: 34, color: "#8b949e" }, author),
    ],
  );

  const svg = await satori(tree, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Tuffy", data: fontRegular, weight: 400, style: "normal" },
      { name: "Tuffy", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

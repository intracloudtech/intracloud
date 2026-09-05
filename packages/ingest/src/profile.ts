import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Post } from "@intracloud/schema";
import { SITE_ORIGIN } from "./config.js";
import type { SyncSummary } from "./sync.js";

/**
 * Regenerate the org `.github` profile README with the latest 10 posts.
 * GitHub sanitizes this markdown aggressively: absolute image URLs only, no
 * scripts. We write it into the data dir; the workflow pushes it to the
 * `.github` repo (needs a PAT with access to both repos).
 */
export async function writeProfileReadme(
  outDir: string,
  _summary: SyncSummary,
): Promise<void> {
  let posts: Post[] = [];
  try {
    const feed = JSON.parse(await readFile(join(outDir, "feed.json"), "utf-8"));
    posts = feed.posts as Post[];
  } catch {
    return;
  }

  const latest = posts
    .filter((p) => !p.draft && !p.backfill && !p.duplicate_of)
    .sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at))
    .slice(0, 10);

  const lines: string[] = [
    "# Intracloud",
    "",
    "A zero-touch blog network. Commit an `intracloud.md` with `intracloud: 1` in its frontmatter, add the `intracloud` repo topic, and it appears here — no signup, no form.",
    "",
    `→ [intracloud.tech](${SITE_ORIGIN})`,
    "",
    "## Latest posts",
    "",
  ];
  for (const p of latest) {
    const date = p.first_seen_at.slice(0, 10);
    lines.push(`- **[${escapeMd(p.title)}](${SITE_ORIGIN}${p.url})** — @${p.author} · ${date}`);
  }
  lines.push("");

  const path = join(outDir, ".github-profile", "README.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines.join("\n"), "utf-8");
}

function escapeMd(s: string): string {
  return s.replace(/([\[\]])/g, "\\$1");
}

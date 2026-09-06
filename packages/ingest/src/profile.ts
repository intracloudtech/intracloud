import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Post } from "@intracloud/schema";
import { avatarUrl } from "@intracloud/schema";
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

  // Same fallback as the homepage: prefer genuinely-new posts, but when the
  // index is still all-backfill, show recent posts so the profile isn't empty.
  const byDate = (a: Post, b: Post) =>
    b.first_seen_at.localeCompare(a.first_seen_at);
  const shown = posts.filter((p) => !p.draft && !p.duplicate_of);
  const strict = shown.filter((p) => !p.backfill).sort(byDate);
  const latest = (strict.length > 0 ? strict : shown.sort(byDate)).slice(0, 10);

  const lines: string[] = [
    "# Intracloud",
    "",
    "A blog network you publish to by committing a file. Add an `intracloud.md` with `intracloud: 1` in its frontmatter, tag the repo with the `intracloud` topic, and it shows up here. No account, no form.",
    "",
    `→ [intracloud.tech](${SITE_ORIGIN})`,
    "",
    "## Latest posts",
    "",
  ];
  for (const p of latest) {
    const date = p.first_seen_at.slice(0, 10);
    const tags = p.tags.length
      ? " · " + p.tags.map((t) => "`" + t + "`").join(" ")
      : "";
    lines.push(`### [${escapeMd(p.title)}](${SITE_ORIGIN}${p.url})`);
    lines.push("");
    lines.push(
      `<img src="${avatarUrl(p.author, 48)}" width="16" height="16" align="top" alt=""> ` +
        `[@${p.author}](https://github.com/${p.author}) · ${date}${tags}`,
    );
    lines.push("");
    if (p.summary) {
      lines.push(p.summary);
      lines.push("");
    }
  }

  const path = join(outDir, ".github-profile", "README.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines.join("\n"), "utf-8");
}

function escapeMd(s: string): string {
  return s.replace(/([\[\]])/g, "\\$1");
}

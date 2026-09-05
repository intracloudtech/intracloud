import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Post } from "@intracloud/schema";
import {
  normalizeTags,
  postUrl,
  rawUrl,
  stripPostFilename,
} from "@intracloud/schema";
import type { GithubClient } from "./github.js";
import type { ImageStore } from "./r2.js";
import type { Logger } from "./logger.js";
import { discover } from "./discover.js";
import { discoverByTopic } from "./discover-topic.js";
import { codeSearchEnabled } from "./config.js";
import { loadState, classifyFile, buildNextState, type State } from "./state.js";
import { parseFile, plainText, deriveSummary, bodyHash, parseMdast } from "./markdown.js";
import { transformBody, rehostCover } from "./transform.js";
import { renderHtml } from "./render.js";
import { makeFetchAsset, makeProcessImage } from "./assetfetch.js";
import { writeData, type PostBody } from "./datawriter.js";

export interface SyncConfig {
  outDir: string;
  aliases: Record<string, string>;
  blocklist: { tags: string[]; repos: string[] };
  now?: string;
  maxSplitDepth?: number;
}

export interface SyncSummary {
  reposSeen: number;
  postsFound: number;
  fetched: number;
  skipped: number;
  failed: number;
  imagesUploaded: number;
  lintWarnings: number;
  duplicates: number;
  feedBytes: number;
  searchRateRemaining: number | null;
  blobRateRemaining: number | null;
}

function contentPathFor(owner: string, repo: string, path: string): string {
  const dir = stripPostFilename(path);
  const slug = dir === "" ? "index" : dir;
  return `content/${owner}/${repo}/${slug}`;
}

async function loadPrevFeed(outDir: string): Promise<Map<string, Post>> {
  try {
    const raw = await readFile(join(outDir, "feed.json"), "utf-8");
    const feed = JSON.parse(raw) as { posts: Post[] };
    return new Map(feed.posts.map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

/** The full sync (Phases 1–6). Never throws on a single bad post. */
export async function runSync(
  client: GithubClient,
  store: ImageStore,
  logger: Logger,
  config: SyncConfig,
): Promise<SyncSummary> {
  const now = config.now ?? new Date().toISOString();
  const state: State = await loadState(join(config.outDir, "state.json"));
  const prevFeed = await loadPrevFeed(config.outDir);

  // Primary discovery: repository search by topic (fresh, reliable index).
  const discovered = await discoverByTopic(client, logger, {
    blockedRepos: config.blocklist.repos,
  });

  // Secondary (opt-in): legacy code search, for repos that happen to be
  // code-indexed without a topic. Off by default — see config.
  if (codeSearchEnabled()) {
    logger.info("code search secondary enabled");
    const extra = await discover(client, logger, {
      blockedRepos: config.blocklist.repos,
      maxSplitDepth: config.maxSplitDepth,
    });
    for (const [id, file] of extra) if (!discovered.has(id)) discovered.set(id, file);
  }

  const summary: SyncSummary = {
    reposSeen: new Set([...discovered.values()].map((f) => f.ownerRepo)).size,
    postsFound: discovered.size,
    fetched: 0,
    skipped: 0,
    failed: 0,
    imagesUploaded: 0,
    lintWarnings: 0,
    duplicates: 0,
    feedBytes: 0,
    searchRateRemaining: null,
    blobRateRemaining: null,
  };

  const posts: Post[] = [];
  const bodies: PostBody[] = [];
  const stateInputs: Array<{
    id: string;
    ownerRepo: string;
    blob_sha: string;
    first_seen_at: string;
    updated_at: string;
    backfill: boolean;
    body_hash: string;
  }> = [];

  for (const file of discovered.values()) {
    const cls = classifyFile(file, state, now);
    const contentPath = contentPathFor(file.owner, file.repo, file.path);

    try {
      if (cls.action === "skip") {
        const prev = prevFeed.get(file.id);
        if (prev) {
          // reuse prior render; carry its body files forward unchanged.
          const md = await readFile(join(config.outDir, prev.contentPath + ".md"), "utf-8").catch(() => "");
          const html = await readFile(join(config.outDir, prev.contentPath + ".html"), "utf-8").catch(() => "");
          posts.push(prev);
          bodies.push({ contentPath: prev.contentPath, markdown: md, html });
          stateInputs.push({
            id: file.id,
            ownerRepo: file.ownerRepo,
            blob_sha: file.sha,
            first_seen_at: cls.first_seen_at,
            updated_at: cls.updated_at,
            backfill: cls.backfill,
            body_hash: cls.body_hash ?? prev.bodyHash,
          });
          summary.skipped++;
          continue;
        }
        // no prior entry (e.g. first run after a schema change) → refetch
      }

      // fetch + build
      const raw = await client.fetchBlob(file.gitUrl);
      const parsed = parseFile(raw);
      if (!parsed.ok || !parsed.frontmatter) {
        logger.warn("post failed validation; skipping", {
          id: file.id,
          errors: parsed.errors.join("; "),
        });
        summary.failed++;
        continue;
      }
      const fm = parsed.frontmatter;
      if (fm.draft) {
        // draft: excluded from index entirely
        logger.info("draft skipped", { id: file.id });
        continue;
      }

      const fetchAsset = makeFetchAsset(client, file.owner, file.repo);
      const processImage = makeProcessImage(store, logger);
      const deps = {
        owner: file.owner,
        repo: file.repo,
        postPath: file.path,
        fetchAsset,
        processImage,
      };

      const t = await transformBody(parsed.body, deps);
      summary.imagesUploaded += t.imagesUploaded;
      const html = await renderHtml(t.markdown);

      const text = plainText(parseMdast(parsed.body));
      const lint = [...parsed.warnings.map((w) => ({ code: "frontmatter", message: w })), ...t.lint];

      // cover
      let cover: string | undefined;
      if (fm.cover) {
        const c = await rehostCover(fm.cover, deps);
        if (c.url) cover = c.url;
        else lint.push({ code: "cover-404", message: `cover image unreachable: ${fm.cover}` });
        lint.push(...c.lint);
      }

      const tags = normalizeTags(fm.tags, {
        aliases: config.aliases,
        blocklist: config.blocklist.tags,
      });

      const post: Post = {
        id: file.id,
        author: file.owner,
        repo: file.repo,
        ownerRepo: file.ownerRepo,
        path: file.path,
        url: postUrl(file.owner, file.repo, file.path),
        rawUrl: rawUrl(file.owner, file.repo, file.path),
        title: fm.title,
        summary: fm.summary ?? deriveSummary(text),
        tags,
        cover,
        canonical: fm.canonical,
        draft: false,
        first_seen_at: cls.first_seen_at,
        updated_at: cls.updated_at,
        blob_sha: file.sha,
        backfill: cls.backfill,
        bodyHash: bodyHash(text),
        contentPath,
        lint,
      };

      posts.push(post);
      bodies.push({
        contentPath,
        markdown: withFrontmatter(post, t.markdown),
        html,
      });
      stateInputs.push({
        id: file.id,
        ownerRepo: file.ownerRepo,
        blob_sha: file.sha,
        first_seen_at: cls.first_seen_at,
        updated_at: cls.updated_at,
        backfill: cls.backfill,
        body_hash: post.bodyHash,
      });
      summary.fetched++;
    } catch (e) {
      logger.warn("post failed; continuing", { id: file.id, error: (e as Error).message });
      summary.failed++;
    }
  }

  // cross-owner dedup: identical body under two owners → earliest is canonical
  dedupeAcrossOwners(posts, summary);

  const nextState = buildNextState(state, stateInputs, now);
  summary.searchRateRemaining = client.lastSearchRateLimit?.remaining ?? null;
  summary.blobRateRemaining = client.lastBlobRateLimit?.remaining ?? null;
  summary.lintWarnings = posts.reduce((n, p) => n + p.lint.length, 0);

  const { feedBytes } = await writeData({
    outDir: config.outDir,
    posts,
    state: nextState,
    bodies,
    generatedAt: now,
  });
  summary.feedBytes = feedBytes;

  logger.info("sync complete", { ...summary });
  return summary;
}

function dedupeAcrossOwners(posts: Post[], summary: SyncSummary): void {
  const byHash = new Map<string, Post[]>();
  for (const p of posts) {
    let arr = byHash.get(p.bodyHash);
    if (!arr) byHash.set(p.bodyHash, (arr = []));
    arr.push(p);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const owners = new Set(group.map((p) => p.author));
    if (owners.size < 2) continue; // same author's own copies are fine
    const canonical = group
      .slice()
      .sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at))[0];
    for (const p of group) {
      if (p.id !== canonical.id) {
        p.duplicate_of = canonical.id;
        summary.duplicates++;
      }
    }
  }
}

/** Re-attach a minimal frontmatter block to the rewritten markdown source. */
function withFrontmatter(post: Post, body: string): string {
  const fm: string[] = ["---", "intracloud: 1", `title: ${JSON.stringify(post.title)}`];
  if (post.summary) fm.push(`summary: ${JSON.stringify(post.summary)}`);
  if (post.tags.length) fm.push(`tags: [${post.tags.join(", ")}]`);
  if (post.canonical) fm.push(`canonical: ${post.canonical}`);
  fm.push("---", "");
  return fm.join("\n") + body;
}

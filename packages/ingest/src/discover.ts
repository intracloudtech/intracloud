import { GithubClient } from "./github.js";
import { FILENAMES, MAX_PAGES, PER_PAGE } from "./config.js";
import {
  defaultRanges,
  rangeToQualifier,
  splitRange,
  type SizeRange,
} from "./slices.js";
import type { Logger } from "./logger.js";

export interface DiscoveredFile {
  id: string; // {owner}/{repo}/{path}
  owner: string;
  repo: string;
  ownerRepo: string; // {owner}/{repo}
  path: string;
  sha: string; // blob sha
  gitUrl: string;
  isMdx: boolean;
}

export interface DiscoverOptions {
  blockedRepos?: string[]; // {owner}/{repo}
  /** cap on adaptive splitting depth to bound total requests. */
  maxSplitDepth?: number;
}

/**
 * Phase 1 — Discover. Sweep every filename × size-slice, paging to the 1000
 * cap, dedupe into a Map keyed {owner}/{repo}/{path}. Detect saturation (a
 * full page 10) LOUDLY and adaptively split that slice so we don't silently
 * lose posts.
 */
export async function discover(
  client: GithubClient,
  logger: Logger,
  opts: DiscoverOptions = {},
): Promise<Map<string, DiscoveredFile>> {
  const blocked = new Set(opts.blockedRepos ?? []);
  const maxSplitDepth = opts.maxSplitDepth ?? 3;
  const found = new Map<string, DiscoveredFile>();

  for (const filename of FILENAMES) {
    const isMdx = filename.endsWith(".mdx");
    // work queue of ranges to sweep for this filename (allows splitting)
    const queue: Array<{ range: SizeRange; depth: number }> = defaultRanges().map(
      (range) => ({ range, depth: 0 }),
    );

    while (queue.length > 0) {
      const { range, depth } = queue.shift()!;
      const sliceQ = rangeToQualifier(range);
      const query = `intracloud filename:${filename} ${sliceQ}`;
      const before = found.size;
      let sliceCount = 0;
      let lastPageItems = 0;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await client.searchCode(query, page);
        lastPageItems = res.items.length;

        for (const item of res.items) {
          const owner = item.repository.owner.login;
          const repo = item.repository.name;
          const ownerRepo = item.repository.full_name;
          if (blocked.has(ownerRepo)) continue;
          const id = `${ownerRepo}/${item.path}`;
          sliceCount++;
          if (!found.has(id)) {
            found.set(id, {
              id,
              owner,
              repo,
              ownerRepo,
              path: item.path,
              sha: item.sha,
              gitUrl: item.git_url,
              isMdx,
            });
          }
        }

        // early break: a short page is the last page
        if (res.items.length < PER_PAGE) break;

        // saturation: page 10 came back full → there are files we can't see
        if (page === MAX_PAGES && res.items.length === PER_PAGE) {
          if (depth < maxSplitDepth) {
            const [a, b] = splitRange(range);
            logger.warn("slice saturated; splitting", {
              filename,
              slice: sliceQ,
              into: [rangeToQualifier(a), rangeToQualifier(b)],
              depth,
            });
            queue.push({ range: a, depth: depth + 1 });
            queue.push({ range: b, depth: depth + 1 });
          } else {
            logger.error("slice saturated at max split depth; POSTS LOST", {
              filename,
              slice: sliceQ,
              depth,
            });
          }
        }
      }

      logger.info("slice swept", {
        filename,
        slice: sliceQ,
        matches: sliceCount,
        newUnique: found.size - before,
        lastPageItems,
      });
    }
  }

  logger.info("discovery complete", { uniqueFiles: found.size });
  return found;
}

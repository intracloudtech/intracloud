import { GithubClient } from "./github.js";
import { DISCOVERY_TOPIC, MAX_PAGES, PER_PAGE } from "./config.js";
import type { DiscoveredFile } from "./discover.js";
import type { Logger } from "./logger.js";

const INTRACLOUD_FILE = /(?:^|\/)intracloud\.mdx?$/;

export interface DiscoverTopicOptions {
  blockedRepos?: string[]; // {owner}/{repo}
  topic?: string;
}

/**
 * Primary discovery: find repos that opted in via `topic:{TOPIC}` (fresh,
 * reliable repo-search index), then read each repo's git tree ONCE to locate
 * every intracloud.md / intracloud.mdx at any depth — with its blob sha, for
 * change detection. No dependence on the (broken-for-new-repos) code index.
 */
export async function discoverByTopic(
  client: GithubClient,
  logger: Logger,
  opts: DiscoverTopicOptions = {},
): Promise<Map<string, DiscoveredFile>> {
  const topic = opts.topic ?? DISCOVERY_TOPIC;
  const blocked = new Set(opts.blockedRepos ?? []);
  const found = new Map<string, DiscoveredFile>();
  const query = `topic:${topic}`;

  const repos: Array<{ owner: string; repo: string; branch: string }> = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.searchRepositories(query, page);
    for (const item of res.items) {
      if (blocked.has(item.full_name)) continue;
      repos.push({
        owner: item.owner.login,
        repo: item.name,
        branch: item.default_branch,
      });
    }
    if (res.items.length < PER_PAGE) break;
    if (page === MAX_PAGES && res.total_count > MAX_PAGES * PER_PAGE) {
      logger.warn("topic search exceeds 1000 repos; some repos not scanned", {
        topic,
        total: res.total_count,
      });
    }
  }
  logger.info("topic search complete", { topic, repos: repos.length });

  for (const { owner, repo, branch } of repos) {
    let filesInRepo = 0;
    try {
      const tree = await client.getTree(owner, repo, branch);
      if (tree.truncated) {
        logger.warn("repo tree truncated; some files may be missed", {
          repo: `${owner}/${repo}`,
        });
      }
      for (const entry of tree.tree) {
        if (entry.type !== "blob") continue;
        if (!INTRACLOUD_FILE.test(entry.path)) continue;
        const ownerRepo = `${owner}/${repo}`;
        const id = `${ownerRepo}/${entry.path}`;
        found.set(id, {
          id,
          owner,
          repo,
          ownerRepo,
          path: entry.path,
          sha: entry.sha, // blob sha — same change-detector code search gave us
          gitUrl: entry.url, // blobs API url
          isMdx: entry.path.endsWith(".mdx"),
        });
        filesInRepo++;
      }
    } catch (e) {
      logger.warn("failed to scan repo tree; skipping", {
        repo: `${owner}/${repo}`,
        error: (e as Error).message,
      });
      continue;
    }
    logger.info("repo scanned", { repo: `${owner}/${repo}`, posts: filesInRepo });
  }

  logger.info("topic discovery complete", { uniqueFiles: found.size });
  return found;
}

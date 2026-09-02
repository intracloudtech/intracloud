import { GithubClient } from "../src/github.js";
import { createLogger } from "../src/logger.js";

export function silentLogger() {
  const lines: string[] = [];
  const logger = createLogger((l) => lines.push(l));
  return { logger, lines };
}

export interface SearchItemSpec {
  full_name: string; // owner/repo
  path: string;
  sha: string;
  content?: string; // for blob fetch
}

function itemJson(spec: SearchItemSpec) {
  const [owner, repo] = spec.full_name.split("/");
  return {
    path: spec.path,
    sha: spec.sha,
    git_url: `https://api.github.com/repos/${spec.full_name}/git/blobs/${spec.sha}`,
    repository: {
      full_name: spec.full_name,
      name: repo,
      owner: { login: owner },
    },
  };
}

export interface MockOptions {
  /**
   * Given the parsed query, return the FULL ordered list of items for that
   * (filename, slice) query. The mock paginates it into pages of 100.
   */
  search: (q: { filename: string; slice: string }) => SearchItemSpec[];
  /** blob content by sha */
  blobs?: Record<string, string>;
  /** rate-limit headers to attach */
  rateRemaining?: number;
}

function makeResponse(body: unknown, opts: MockOptions, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.rateRemaining !== undefined) {
    headers.set("x-ratelimit-remaining", String(opts.rateRemaining));
    headers.set("x-ratelimit-limit", "5000");
    headers.set("x-ratelimit-reset", "9999999999");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function mockGithubClient(opts: MockOptions) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = new URL(url.toString());
    calls.push(u.pathname + u.search);

    if (u.pathname === "/search/code") {
      const q = u.searchParams.get("q") ?? "";
      const page = Number(u.searchParams.get("page") ?? "1");
      const perPage = Number(u.searchParams.get("per_page") ?? "100");
      const filename = /filename:(intracloud\.mdx?)/.exec(q)?.[1] ?? "";
      const slice = /size:\S+/.exec(q)?.[0] ?? "";
      const all = opts.search({ filename, slice });
      const start = (page - 1) * perPage;
      const items = all.slice(start, start + perPage).map(itemJson);
      return makeResponse(
        { total_count: all.length, incomplete_results: false, items },
        opts,
      );
    }

    // blob fetch
    const sha = /\/git\/blobs\/([^/?]+)/.exec(u.pathname)?.[1];
    if (sha) {
      const content = opts.blobs?.[sha] ?? "";
      return makeResponse(
        {
          content: Buffer.from(content, "utf-8").toString("base64"),
          encoding: "base64",
        },
        opts,
      );
    }

    return makeResponse({ message: "not found" }, opts, 404);
  }) as unknown as typeof fetch;

  const { logger, lines } = silentLogger();
  const client = new GithubClient({
    fetch: fetchImpl,
    sleep: async () => {},
    logger,
    token: "test-token",
  });
  return { client, logger, lines, calls };
}

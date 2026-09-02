import {
  GITHUB_API,
  USER_AGENT,
  PER_PAGE,
  CODE_SEARCH_SLEEP_MS,
} from "./config.js";
import type { Logger } from "./logger.js";

/** One item from the code search response we care about. */
export interface CodeSearchItem {
  path: string;
  /** BLOB sha (file contents), NOT a commit sha. Change detector only. */
  sha: string;
  /** Already-authenticated blobs API URL. Fetch this directly. */
  git_url: string;
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
}

export interface CodeSearchPage {
  total_count: number;
  incomplete_results: boolean;
  items: CodeSearchItem[];
}

export interface BlobResult {
  /** decoded UTF-8 file content */
  content: string;
  /** raw bytes (for images, though images come from a different endpoint) */
  sha: string;
}

export interface RateLimit {
  remaining: number;
  limit: number;
  reset: number; // epoch seconds
}

/** Injectable dependencies so the whole client runs offline in tests. */
export interface GithubDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
  token: string;
}

export const realSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function parseRateLimit(headers: Headers): RateLimit | null {
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining == null) return null;
  return {
    remaining: Number(remaining),
    limit: Number(headers.get("x-ratelimit-limit") ?? "0"),
    reset: Number(headers.get("x-ratelimit-reset") ?? "0"),
  };
}

export class AuthError extends Error {}

export class GithubClient {
  private lastSearchAt = 0;
  /** Last observed core (blob) rate limit. */
  lastBlobRateLimit: RateLimit | null = null;
  lastSearchRateLimit: RateLimit | null = null;

  constructor(private deps: GithubDeps) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.deps.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    };
  }

  /**
   * One code search page. Throttled to respect the 10 req/min limit: we never
   * fire two search requests closer than CODE_SEARCH_SLEEP_MS apart.
   * Retries 5xx with backoff; throws AuthError on 401/403-auth.
   */
  async searchCode(query: string, page: number): Promise<CodeSearchPage> {
    // Throttle relative to the previous search call.
    const since = Date.now() - this.lastSearchAt;
    if (this.lastSearchAt !== 0 && since < CODE_SEARCH_SLEEP_MS) {
      await this.deps.sleep(CODE_SEARCH_SLEEP_MS - since);
    }

    const url = `${GITHUB_API}/search/code?per_page=${PER_PAGE}&page=${page}&q=${encodeURIComponent(
      query,
    )}`;

    const res = await this.withRetry(() =>
      this.deps.fetch(url, { headers: this.headers() }),
    );
    this.lastSearchAt = Date.now();

    const rl = parseRateLimit(res.headers);
    if (rl) this.lastSearchRateLimit = rl;

    if (res.status === 401) {
      throw new AuthError(`code search auth failed (401): ${await safeText(res)}`);
    }
    if (res.status === 403) {
      // Distinguish auth failure from secondary rate limiting.
      const body = await safeText(res);
      if (/rate limit|secondary/i.test(body)) {
        this.deps.logger.warn("secondary rate limit hit; backing off", { page });
        await this.deps.sleep(CODE_SEARCH_SLEEP_MS * 3);
        return this.searchCode(query, page);
      }
      throw new AuthError(`code search forbidden (403): ${body}`);
    }
    if (!res.ok) {
      throw new Error(`code search failed (${res.status}): ${await safeText(res)}`);
    }
    return (await res.json()) as CodeSearchPage;
  }

  /** Fetch and base64-decode a blob by its already-formed git_url. */
  async fetchBlob(gitUrl: string): Promise<string> {
    const res = await this.withRetry(() =>
      this.deps.fetch(gitUrl, { headers: this.headers() }),
    );
    const rl = parseRateLimit(res.headers);
    if (rl) this.lastBlobRateLimit = rl;

    if (res.status === 401 || res.status === 403) {
      const body = await safeText(res);
      if (res.status === 403 && /rate limit/i.test(body)) {
        throw new Error(`blob rate limited: ${body}`);
      }
      throw new AuthError(`blob auth failed (${res.status}): ${body}`);
    }
    if (!res.ok) {
      throw new Error(`blob fetch failed (${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as {
      content: string;
      encoding: string;
    };
    if (json.encoding !== "base64") {
      throw new Error(`unexpected blob encoding: ${json.encoding}`);
    }
    return Buffer.from(json.content, "base64").toString("utf-8");
  }

  /**
   * Fetch a repo file's raw bytes via the contents API (authenticated,
   * 5000/hr, honours rate-limit headers). Returns null on 404 so a missing
   * relative image degrades to a lint warning rather than aborting the post.
   */
  async fetchContentBytes(
    owner: string,
    repo: string,
    path: string,
  ): Promise<Buffer | null> {
    const encPath = path
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encPath}`;
    const res = await this.withRetry(() =>
      this.deps.fetch(url, {
        headers: { ...this.headers(), Accept: "application/vnd.github.raw+json" },
      }),
    );
    const rl = parseRateLimit(res.headers);
    if (rl) this.lastBlobRateLimit = rl;
    if (res.status === 404) return null;
    if (res.status === 401) throw new AuthError("contents auth failed (401)");
    if (!res.ok) throw new Error(`contents fetch failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Fetch raw bytes from an authenticated URL (used for image assets). */
  async fetchBytes(url: string): Promise<Buffer> {
    const res = await this.withRetry(() =>
      this.deps.fetch(url, { headers: this.headers() }),
    );
    const rl = parseRateLimit(res.headers);
    if (rl) this.lastBlobRateLimit = rl;
    if (!res.ok) {
      throw new Error(`asset fetch failed (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Retry transient 5xx up to 4 times with exponential backoff. */
  private async withRetry(fn: () => Promise<Response>): Promise<Response> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fn();
      if (res.status < 500 || attempt >= 3) return res;
      const wait = 500 * 2 ** attempt;
      this.deps.logger.warn("5xx from github; retrying", {
        status: res.status,
        attempt,
        wait,
      });
      await this.deps.sleep(wait);
      attempt++;
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

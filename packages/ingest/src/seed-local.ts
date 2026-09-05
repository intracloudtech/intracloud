/**
 * Offline end-to-end seed. Runs the REAL sync pipeline against a mocked GitHub
 * so we can populate a data branch and build the site without any network.
 *
 * Two generations so the backfill guard has something to do: generation 1
 * marks every post as backfill (repo's first sync); generation 2 adds new
 * posts to already-known repos, which are genuinely new and reach Latest.
 *
 *   tsx src/seed-local.ts   → writes <repo>/data-branch
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
import { GithubClient } from "./github.js";
import { createLogger } from "./logger.js";
import { runSync } from "./sync.js";
import { DataDirStore } from "./r2.js";

// A real PNG so the image pipeline (fetch → webp → data-branch assets/) runs.
const demoPng = await sharp({
  create: { width: 800, height: 400, channels: 3, background: { r: 37, g: 99, b: 235 } },
})
  .png()
  .toBuffer();

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const outDir = resolve(repoRoot, "data-branch");
const selfPost = readFileSync(resolve(repoRoot, "intracloud.md"), "utf-8");
const aliases = JSON.parse(readFileSync(resolve(repoRoot, "data/aliases.json"), "utf-8"));
const blocklist = JSON.parse(readFileSync(resolve(repoRoot, "data/blocklist.json"), "utf-8"));

interface Spec {
  full_name: string;
  path: string;
  sha: string;
  content: string;
}

function post(title: string, tags: string[], body: string): string {
  return `---\nintracloud: 1\ntitle: ${title}\ntags: [${tags.join(", ")}]\n---\n\n${body}\n`;
}

const gen1: Spec[] = [
  { full_name: "intracloudtech/intracloud", path: "intracloud.md", sha: "self-1", content: selfPost },
  {
    full_name: "sam/blog",
    path: "posts/rust-gc/intracloud.md",
    sha: "sam-1",
    content: post("Writing a garbage collector in Rust", ["rust", "gc", "systems"],
      "I spent a weekend building a mark-and-sweep collector. Here is what I learned about pointers, roots, and the borrow checker fighting me the whole way."),
  },
  {
    full_name: "amy/notes",
    path: "k8s/intracloud.md",
    sha: "amy-1",
    content: post("Debugging a Kubernetes CrashLoopBackOff", ["k8s", "devops", "postmortem"],
      "A pod kept restarting every 40 seconds. The logs were empty. The real cause was a liveness probe timing out during a slow migration."),
  },
];

const gen2: Spec[] = [
  ...gen1,
  {
    full_name: "sam/blog",
    path: "posts/async-io/intracloud.md",
    sha: "sam-2",
    content: post("How async I/O actually schedules", ["rust", "async", "systems"],
      "Futures don't run themselves. Someone has to poll them. This post traces exactly who does the polling and when."),
  },
  {
    full_name: "amy/notes",
    path: "sql/intracloud.md",
    sha: "amy-2",
    content: post("The query planner is not your enemy", ["postgresql", "sql", "performance"],
      "A missing index turned a 4ms query into a 9 second table scan. Here is how to read EXPLAIN ANALYZE without panicking."),
  },
  {
    full_name: "sam/blog",
    path: "posts/traits/intracloud.md",
    sha: "sam-3",
    content: post("Trait objects vs generics in Rust", ["rust", "systems", "performance"],
      "Static dispatch is fast but bloats your binary. Dynamic dispatch is one pointer indirection. Here is when each one actually matters."),
  },
  {
    full_name: "kai/devlog",
    path: "intracloud.md",
    sha: "kai-1",
    content: post("Shipping a static site with zero JavaScript", ["astro", "web", "performance"],
      "Every page is prerendered HTML. The only script on the whole site is the search box.\n\n![architecture](./diagram.png)\n\nLighthouse is very happy about this."),
  },
];

function mockClient(specs: Spec[]) {
  const blobs: Record<string, string> = {};
  for (const s of specs) blobs[s.sha] = s.content;
  const fetchImpl = (async (url: string) => {
    const u = new URL(url.toString());

    // topic-based repository search (primary discovery)
    if (u.pathname === "/search/repositories") {
      const page = Number(u.searchParams.get("page") ?? "1");
      const names = [...new Set(specs.map((s) => s.full_name))];
      const items =
        page === 1
          ? names.map((full) => {
              const [owner, name] = full.split("/");
              return { full_name: full, name, owner: { login: owner }, default_branch: "main" };
            })
          : [];
      return new Response(
        JSON.stringify({ total_count: names.length, incomplete_results: false, items }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // recursive git tree per repo
    const treeM = /\/repos\/([^/]+)\/([^/]+)\/git\/trees\//.exec(u.pathname);
    if (treeM) {
      const full = `${treeM[1]}/${treeM[2]}`;
      const tree = specs
        .filter((s) => s.full_name === full)
        .map((s) => ({
          path: s.path,
          type: "blob",
          sha: s.sha,
          url: `https://api.github.com/repos/${full}/git/blobs/${s.sha}`,
        }));
      return new Response(JSON.stringify({ sha: "root", tree, truncated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const sha = /\/git\/blobs\/([^/?]+)/.exec(u.pathname)?.[1];
    if (sha && blobs[sha] !== undefined) {
      return new Response(
        JSON.stringify({ content: Buffer.from(blobs[sha]).toString("base64"), encoding: "base64" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // relative image assets (contents API, raw bytes)
    if (/\/contents\/.+\.png$/.test(u.pathname)) {
      return new Response(new Uint8Array(demoPng), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  }) as unknown as typeof fetch;

  const logger = createLogger();
  return new GithubClient({ fetch: fetchImpl, sleep: async () => {}, logger, token: "seed" });
}

async function main() {
  const logger = createLogger();
  logger.info("seed: generation 1 (first sync — everything backfill)");
  await runSync(mockClient(gen1), new DataDirStore(outDir), logger, {
    outDir,
    aliases,
    blocklist,
    now: "2026-08-20T09:00:00.000Z",
    maxSplitDepth: 0,
  });

  logger.info("seed: generation 2 (new posts in known repos → Latest)");
  const summary = await runSync(mockClient(gen2), new DataDirStore(outDir), logger, {
    outDir,
    aliases,
    blocklist,
    now: "2026-09-01T12:00:00.000Z",
    maxSplitDepth: 0,
  });
  logger.info("seed complete", { outDir, ...summary });
}

main();

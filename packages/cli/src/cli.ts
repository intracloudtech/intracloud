#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import pc from "picocolors";

const VERSION = "0.1.0";
const DEFAULT_SITE = "https://intracloud.tech";

interface Post {
  id: string;
  author: string;
  repo: string;
  url: string;
  rawUrl: string;
  title: string;
  summary?: string;
  tags: string[];
  first_seen_at: string;
  backfill?: boolean;
  duplicate_of?: string;
}
interface Feed {
  posts: Post[];
}

const CACHE_DIR = join(homedir(), ".cache", "intracloud");
const CACHE_FILE = join(CACHE_DIR, "last.json");

// ── arg parsing ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") flags.json = true;
  else if (a === "--help" || a === "-h") flags.help = true;
  else if (a === "--version" || a === "-v") flags.version = true;
  else if (a === "--site") flags.site = argv[++i];
  else if (a.startsWith("--site=")) flags.site = a.slice(7);
  else if (a === "-n" || a === "--limit") flags.limit = argv[++i];
  else positional.push(a);
}
const SITE = (
  (flags.site as string) ||
  process.env.INTRACLOUD_URL ||
  DEFAULT_SITE
).replace(/\/+$/, "");
const asJson = flags.json === true;

// ── helpers ──────────────────────────────────────────────────────────────────
async function getFeed(): Promise<Post[]> {
  const res = await fetch(`${SITE}/feed.json`);
  if (!res.ok) fail(`could not fetch ${SITE}/feed.json (${res.status})`);
  const feed = (await res.json()) as Feed;
  // readers see everything except cross-owner duplicates
  return feed.posts.filter((p) => !p.duplicate_of);
}

function byDateDesc(a: Post, b: Post) {
  return b.first_seen_at.localeCompare(a.first_seen_at);
}

function fail(msg: string): never {
  console.error(pc.red("error: ") + msg);
  process.exit(1);
}

function cacheList(posts: Post[]) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(posts.map((p) => p.url)));
  } catch {
    /* cache is best-effort */
  }
}

function resolveTarget(ref: string, feed: Post[]): Post | undefined {
  // a number → index into the last listing
  if (/^\d+$/.test(ref)) {
    const idx = Number(ref) - 1;
    if (existsSync(CACHE_FILE)) {
      const urls = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as string[];
      const url = urls[idx];
      if (url) return feed.find((p) => p.url === url);
    }
    return undefined;
  }
  // a url or path: /@owner/repo/..., @owner/repo/..., or a full URL
  let path = ref.replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/")) path = "/" + path;
  path = path.replace(/\.md$/, "").replace(/\/+$/, "");
  return feed.find((p) => p.url === path);
}

function printList(posts: Post[]) {
  if (asJson) {
    console.log(JSON.stringify(posts, null, 2));
    return;
  }
  if (posts.length === 0) {
    console.log(pc.dim("no posts."));
    return;
  }
  cacheList(posts);
  posts.forEach((p, i) => {
    const n = pc.dim(String(i + 1).padStart(2) + ".");
    const date = pc.dim(p.first_seen_at.slice(0, 10));
    const arch = p.backfill ? pc.dim(" (archived)") : "";
    console.log(`${n} ${pc.bold(p.title)}${arch}`);
    const tags = p.tags.length ? "  " + p.tags.map((t) => pc.cyan("#" + t)).join(" ") : "";
    console.log(`    ${pc.green("@" + p.author)} ${date}${tags}`);
    if (p.summary) console.log(pc.dim("    " + truncate(p.summary, 96)));
    console.log("");
  });
  console.log(pc.dim(`Read one with:  intracloud read <number>`));
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

// ── commands ─────────────────────────────────────────────────────────────────
async function cmdList() {
  const limit = flags.limit ? Number(flags.limit) : 20;
  const posts = (await getFeed())
    .filter((p) => !p.backfill)
    .sort(byDateDesc)
    .slice(0, limit);
  // if the strict feed is empty (fresh index), show recent incl. archived
  const shown =
    posts.length > 0
      ? posts
      : (await getFeed()).sort(byDateDesc).slice(0, limit);
  printList(shown);
}

async function cmdSearch() {
  const q = positional.slice(1).join(" ").toLowerCase();
  if (!q) fail("usage: intracloud search <query>");
  const hits = (await getFeed())
    .filter((p) => {
      const hay = [p.title, p.summary ?? "", p.author, p.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort(byDateDesc);
  printList(hits);
}

async function cmdAuthor() {
  const name = (positional[1] || "").replace(/^@/, "");
  if (!name) fail("usage: intracloud author <name>");
  const posts = (await getFeed())
    .filter((p) => p.author.toLowerCase() === name.toLowerCase())
    .sort(byDateDesc);
  printList(posts);
}

async function cmdTag() {
  const tag = positional[1];
  if (!tag) fail("usage: intracloud tag <tag>");
  const posts = (await getFeed())
    .filter((p) => p.tags.includes(tag))
    .sort(byDateDesc);
  printList(posts);
}

async function cmdTags() {
  const counts = new Map<string, number>();
  for (const p of await getFeed())
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (asJson) {
    console.log(JSON.stringify(Object.fromEntries(sorted), null, 2));
    return;
  }
  for (const [tag, n] of sorted) {
    console.log(`${pc.cyan("#" + tag)} ${pc.dim(String(n))}`);
  }
}

async function cmdRead() {
  const ref = positional[1];
  if (!ref) fail("usage: intracloud read <number|url>");
  const feed = await getFeed();
  const post = resolveTarget(ref, feed);
  if (!post) fail(`no post matches "${ref}". Run \`intracloud latest\` first.`);
  const res = await fetch(`${SITE}${post.rawUrl}`);
  if (!res.ok) fail(`could not fetch the post (${res.status})`);
  const md = stripFrontmatter(await res.text());

  if (asJson) {
    console.log(JSON.stringify({ ...post, markdown: md }, null, 2));
    return;
  }
  marked.use(markedTerminal() as any);
  console.log("");
  console.log(pc.bold(pc.underline(post.title)));
  console.log(
    pc.green("@" + post.author) +
      pc.dim(` · ${post.first_seen_at.slice(0, 10)} · ${SITE}${post.url}`),
  );
  if (post.tags.length) console.log(post.tags.map((t) => pc.cyan("#" + t)).join(" "));
  console.log("");
  console.log((marked.parse(md) as string).trimEnd());
}

async function cmdOpen() {
  const ref = positional[1];
  if (!ref) fail("usage: intracloud open <number|url>");
  const post = resolveTarget(ref, await getFeed());
  if (!post) fail(`no post matches "${ref}".`);
  const url = `${SITE}${post.url}`;
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  console.log(pc.dim("opening ") + url);
}

function help() {
  console.log(`${pc.bold("intracloud")} ${pc.dim("v" + VERSION)} — read Intracloud posts in your terminal

${pc.bold("Usage")}
  intracloud [latest] [-n N]      list the latest posts
  intracloud search <query>       search titles, summaries, tags, authors
  intracloud read <number|url>    read a post (number is from the last list)
  intracloud open <number|url>    open a post in your browser
  intracloud author <name>        posts by a GitHub user
  intracloud tag <tag>            posts with a tag
  intracloud tags                 all tags with counts

${pc.bold("Options")}
  --site <url>    override the instance (default ${DEFAULT_SITE})
  --json          machine-readable output
  -n, --limit N   how many to list
  -h, --help      this help
  -v, --version   version

${pc.dim("Also honors INTRACLOUD_URL for the instance URL.")}`);
}

// ── dispatch ─────────────────────────────────────────────────────────────────
async function main() {
  if (flags.version) return console.log(VERSION);
  if (flags.help) return help();
  const cmd = positional[0] ?? "latest";
  try {
    switch (cmd) {
      case "latest": case "ls": case "list": return await cmdList();
      case "search": case "s": return await cmdSearch();
      case "read": case "r": case "cat": return await cmdRead();
      case "open": case "o": return await cmdOpen();
      case "author": case "a": return await cmdAuthor();
      case "tag": return await cmdTag();
      case "tags": return await cmdTags();
      default:
        console.error(pc.red(`unknown command: ${cmd}`));
        help();
        process.exit(1);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main();

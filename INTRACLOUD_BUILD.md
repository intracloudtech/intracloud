# Build Intracloud

Build a blog platform that indexes every file named `intracloud.md` on public GitHub and renders them as a unified feed. Authors never sign up, never submit anything, never touch a form. They commit a file with `intracloud: 1` in its frontmatter and it appears.

A scheduled GitHub Action does all the work: searches GitHub, fetches changed files, rewrites their assets, and force-pushes a data branch. A static Astro site reads that branch and prerenders every page.

There is no server, no database, and no user auth anywhere in this system.

---

## Read this section before writing any code

These are constraints verified against the live APIs. Several are counterintuitive and will produce silently broken behavior if you assume otherwise.

**Code search requires a search term.** `filename:intracloud.md` alone is rejected by the API. The query must contain a bare term. This is why `intracloud: 1` is a required frontmatter key — every valid file literally contains the word, so `intracloud filename:intracloud.md` is both legal and precise. Do not remove that key from the schema.

**Code search caps at 1000 results.** 100 per page, 10 pages, hard stop — and the cap is *per query*, not per account. Partition on the `size:` qualifier (file size in bytes) into disjoint ranges so every file falls in exactly one slice and each slice gets its own fresh 1000-result budget.

`size:` ranges are **inclusive on both ends**, so `1000..3000` and `3000..6000` both match 3000. Boundaries must not touch:

```js
const SLICES = [
  "size:<1000",
  "size:1000..3000",
  "size:3001..6000",
  "size:6001..12000",
  "size:>12000",
];
```

Tuned for markdown blog posts, which typically run 2–8 KB. Do not use narrow low-end slices — they return almost nothing while the top slice saturates.

**Detect saturation.** If page 10 of a slice returns a full 100 items, that slice is truncated and there are files you cannot see. Log per-slice counts every run, and split any saturated slice in two. This is the failure mode that silently loses posts, so make it loud.

**Code search is 10 requests per minute.** Not per hour. Sleep 6.5s between calls. A full sweep of 4 slices × 10 pages is ~40 requests and takes about 4 minutes.

**The `sha` in a code search result is a BLOB sha, not a commit sha.** It identifies file contents, not a point in history. It will not resolve as a git ref. Use it only as a change detector and as the argument to the blobs API.

**Code search only indexes default branches, files under 384 KB, and excludes forks by default.** Do not add `fork:true`. Fork exclusion is free dedup.

**GitHub's search index lags.** A newly pushed file becomes searchable within minutes to an hour. "Push and it appears" means "within the hour." Do not build anything that assumes immediacy.

**Never fetch from `raw.githubusercontent.com`.** It rate limits unauthenticated requests, returns no `x-ratelimit-*` headers so you cannot tell how close you are, and ignores tokens — sending a bad `Authorization` header turns a 200 into a 404. Use the blobs API (`git_url` from the search result), which is authenticated, 5000/hour, and returns full rate limit headers.

**The default `GITHUB_TOKEN` in Actions cannot do cross-repo code search.** Use a PAT in secrets.

---

## Repo layout

One repo, two branches.

```
main                          source
  .github/workflows/sync.yml
  packages/ingest/            the Action's code (TypeScript, Node 20+)
  packages/site/              Astro
  data/aliases.json           hand-curated tag aliases
  data/blocklist.json         blocked tags, blocked repos
  intracloud.md               Intracloud indexes itself. First post.

data                          orphan branch, force-pushed each run
  feed.json
  state.json                  blob shas + first_seen_at, for change detection
  content/{owner}/{repo}/{path}.md
```

The data branch is orphan and force-pushed so history never accumulates. A deleted post is genuinely gone on the next run. Create it with `git checkout --orphan`.

Images do **not** go in git. They go to Cloudflare R2.

---

## Phase 1 — Discover

```
GET /search/code?per_page=100&page={n}&q=intracloud+filename:intracloud.md+{slice}
```

Loop `SLICES`, loop pages 1–10, sleep 6.5s between calls, break early when a page returns fewer than 100 items. Dedupe into a Map keyed `{owner}/{repo}/{path}`. Log the count per slice and warn on saturation.

Also search `filename:intracloud.mdx` and index those files, but treat them as plain markdown. MDX compilation is explicitly out of scope for v1 — see the end of this doc.

From each result you get `repository.full_name`, `repository.owner.login`, `path`, `sha` (blob), and `git_url`. You get **no date and no title.** Those come from the file contents.

## Phase 2 — Fetch only what changed

Load `state.json` from the data branch. For each discovered file, compare the blob sha against the stored one. Identical means byte-identical: skip entirely. After the first sync, a typical run fetches almost nothing.

For changed or new files, fetch `git_url` directly (it is already the blobs API URL — do not construct it). Base64-decode.

Track rate limits from `x-ratelimit-remaining` and back off before exhaustion rather than after.

## Phase 3 — Parse and validate

Define the schema once, in Zod, in a file both the ingest and the site import.

```yaml
---
intracloud: 1          # REQUIRED. search token + schema version.
title: How I broke prod # REQUIRED.
summary: One line       # optional. else first ~200 chars of body text.
tags: [postmortem]      # optional. normalized, capped at 5.
cover: ./cover.png      # optional. relative or absolute.
canonical: https://…    # optional. cross-posted originals.
draft: true             # optional. skip indexing.
---
```

Exactly two required fields. **Fail closed on those two only.** Unknown keys produce a warning and pass through — otherwise you can never add a field without breaking every existing file.

There is no `date`, no `slug`, no `authors`, no `mirror`, and no `lang` field. Do not add them.

- **Publish date is `first_seen_at`**, recorded by you when the post first enters the index. Never author-supplied, so it cannot be gamed.
- **Author is `repository.owner.login`.** GitHub owns the namespace; you inherit identity, avatars, and bios for free.
- **Updated is the blob sha changing.** Byte truth.

**Backfill guard:** on a repo's *first* sync, mark every post `backfill: true` and exclude it from the Latest feed. It still appears on the author page, in search, and under tags. Without this, an author with 50 existing posts floods the feed on discovery. Only posts appearing in a *subsequent* sync are genuinely new.

## Phase 4 — Transform

Walk the mdast once and do all of these in the same pass.

**Images.** Resolve relative paths against the post's directory; take absolute URLs as-is. Fetch the bytes, convert to WebP at max 1600px wide, hash the content, upload to R2 at `https://cdn.intracloud.tech/i/{sha256:16}.webp`, rewrite the `src`. Handle both mdast `image` nodes and `src` attributes on raw `<img>` HTML.

Re-host absolute URLs too — do not pass them through. Passing through leaks every reader's IP to arbitrary hosts and breaks the post when those hosts rot.

Content addressing means identical images collapse to one object and the URL is immutable, so cache it for a year.

Skip images over 10 MB. Cap total assets per post. Record a lint warning when a source 404s.

**Links.** Rewrite relative links between posts in the same pass. `../rust-gc/` becomes `/@sam/notes/2026/rust-gc`, not a dead link.

**Tags.** Normalize hard:

```js
const norm = (t) => t.normalize("NFKC").toLowerCase().trim()
  .replace(/[\s_]+/g, "-")
  .replace(/[^\p{L}\p{N}-]/gu, "")   // keep unicode letters
  .replace(/-{2,}/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 30);
```

Then dedupe, drop empties, cap at 5, apply `aliases.json` (`k8s` → `kubernetes`, `js` → `javascript`), drop anything in `blocklist.json`.

A tag needs **3 or more posts** before `/t/{tag}` becomes a real page. Below that it exists in the data but renders no route. Thousands of thin single-post tag pages are both SEO poison and a spam surface.

**Sanitize.** Strip script tags and event handler attributes from raw HTML. This is untrusted input from strangers.

**Dedup.** Hash the normalized body text. If the same hash appears under two different owners, the earlier `first_seen_at` is canonical and the other links to it.

## Phase 5 — URLs

Slug is the path. Nothing is author-controlled, so collisions are structurally impossible: paths are unique within a repo, repo names unique within an owner.

Production domain is **intracloud.tech**. Canonical URLs, OG tags, RSS `<link>` elements, sitemap, and the `.github` profile README all use `https://intracloud.tech` — set it as `site` in `astro.config.mjs` so Astro derives absolute URLs from it. No trailing slashes.

```
https://intracloud.tech/
/@sam                          author, all repos
/@sam/blog                     repo collection
/@sam/blog/posts/hello-world   post
/t/rust                        tag
/search
```

Serve assets from a separate origin (`cdn.intracloud.tech`, an R2 custom domain) so image requests never carry site cookies and the bucket can be swapped without touching page URLs.

Catch-all route: `/@:owner/:repo/*path`. Strip the `intracloud.md` filename from the end. A file at repo root renders at `/@sam/blog`.

Reserve as first segments: `search`, `feed`, `rss`, `about`, `api`, `t`, `settings`, `_astro`.

Also serve `/@sam/blog/posts/hello-world.md` returning raw source. Cheap, and this audience notices.

## Phase 6 — Publish

Write `feed.json`, `state.json`, and `content/`. Guard the commit or you generate 17,000 empty commits a year:

```bash
git diff --quiet || git commit -am "sync $(date -u +%F-%H%M)"
git push -f origin data
```

Shard `feed.json` by month once it exceeds ~1 MB.

Regenerate `.github/profile/README.md` in the org's `.github` repo with the latest 10 posts. GitHub sanitizes that markdown aggressively: absolute image URLs only, no scripts. Needs a PAT with access to both repos.

## Phase 7 — Site

**Astro, static output, zero JS by default.** Not Nextra — it assumes MDX files are pages in your own repo and fights content arriving from elsewhere.

Use the **Content Layer API** with a custom loader reading `feed.json` and `content/` from the data branch. The Zod schema from Phase 3 is the loader's schema — validation you already need, reused.

The only JavaScript island is search: MiniSearch over `feed.json` (title, summary, tags, author). No body text in the client index; add chunked full-text later if needed.

Every page prerendered. This is the entire reason for the architecture — crawlers and link unfurlers get real HTML, so shared links have previews and posts are indexable.

Per-post OG images generated at build via `satori` or Astro's built-in support.

Feed ranking for v1: reverse chronological on `first_seen_at`, excluding `backfill` and `draft`, capped at 2 posts per author per 24h window so one prolific committer can't dominate.

Ship an RSS feed at `/rss.xml`.

Show lint warnings on the post page so authors discover their own broken images and malformed frontmatter from you rather than from a reader.

## Phase 8 — Workflow

```yaml
on:
  schedule: [{ cron: "*/30 * * * *" }]
  workflow_dispatch:
permissions: { contents: write }
```

Concurrency group so runs don't overlap. Retry with backoff on 5xx. Fail loudly on auth errors, warn and continue on individual file failures — one malformed post must never abort a sync.

Log per run: repos seen, posts found, fetched vs skipped, images uploaded, lint warnings, rate limit remaining.

---

## Tests

Write these before the code they cover.

- Frontmatter parser: missing required fields, unknown keys, malformed YAML, empty file, frontmatter-only file
- Tag normalizer: unicode, emoji, casing, duplicates, over-cap, alias resolution, blocklist
- Image rewriter: relative, absolute, `data:` URIs, missing files, raw `<img>` tags, 404 sources
- Path-to-URL: root file, nested, deeply nested, reserved words, trailing slashes
- Change detection: unchanged blob sha skips fetch entirely
- Backfill: first sync marks all, second sync marks only new
- Pagination: correct early break at fewer than 100 items, slice boundaries are disjoint

Mock all GitHub responses. The test suite must run offline.

---

## Explicitly out of scope for v1

Do not build these. Each was considered and deliberately cut.

- **MDX compilation.** Arbitrary JS from strangers. Index `.mdx` files as plain markdown. When it's added it will be a fixed component allowlist with imports and expressions rejected at the AST level, compiled in an isolated worker — not a runtime eval.
- **User accounts, OAuth, login of any kind.** Readers never authenticate. GitHub does not support browser-only OAuth (PKCE still requires a client secret; device flow endpoints send no CORS headers), and a login wall on a public blog kills SEO and link previews.
- **Comments, reactions, follows, personalized feeds.**
- **A search backend.** MiniSearch client-side is enough well past 5000 posts.
- **A submission form.** Discovery is zero-touch by design. This is the product.

---

## One decision left open

This spec assumes you host both the markdown and the images. If the concern is legal exposure rather than cost, the alternative is index-only: keep metadata and a pointer, link out to GitHub for the post body, host nothing. That trades away SEO, link previews, and prerendering — most of the value here.

Do not build the middle version where you serve the text but hotlink the images. It carries the same exposure as hosting, plus reader IP leakage and silent breakage.

Ask before starting if this isn't already settled.

---

## Build order

1. Zod schema + frontmatter parser + tests
2. Code search client with slice pagination and throttling
3. Change detection against `state.json`
4. Blob fetch + mdast transform (images, links, tags, sanitize)
5. R2 upload
6. Data branch writer
7. Astro loader + routes + OG images + RSS
8. Workflow + logging
9. Add `intracloud.md` to this repo and verify it indexes itself end to end

Work in phase order. Run the test suite after each. Commit per phase.

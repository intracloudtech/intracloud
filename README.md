# Intracloud

A zero-touch blog network. It indexes every file named `intracloud.md` on
public GitHub whose frontmatter contains `intracloud: 1`, and renders them as a
unified, prerendered feed at **[intracloud.tech](https://intracloud.tech)**.

There is no server, no database, and no user auth anywhere in this system.
Authors never sign up, never submit anything, never touch a form — they commit a
file and it appears.

## How it works

```
main (source)                         data (orphan branch, force-pushed)
  .github/workflows/sync.yml            feed.json
  packages/schema/   shared Zod         state.json     blob shas + first_seen_at
  packages/ingest/   the Action         search-index.json
  packages/site/     Astro              content/{owner}/{repo}/{path}.{md,html}
  data/aliases.json                     assets/{sha}.webp   re-hosted images
  data/blocklist.json                   .github-profile/README.md
  intracloud.md      first post
```

A scheduled GitHub Action (`packages/ingest`):

1. **Discovers** — code-searches GitHub for `intracloud filename:intracloud.md`,
   partitioned across `size:` slices to beat the 1000-result-per-query cap,
   throttled to the 10 req/min code-search limit, with loud saturation
   detection + adaptive slice splitting.
2. **Detects change** — compares each file's blob sha against `state.json`;
   byte-identical files are skipped entirely.
3. **Transforms** — one mdast pass re-hosts images (WebP, ≤1600px,
   content-addressed) into the data branch under `assets/`, rewrites relative
   inter-post links, normalizes tags, sanitizes untrusted HTML.
4. **Publishes** — writes `feed.json` / `state.json` / `content/` and
   force-pushes the orphan `data` branch (flat history).

A static **Astro** site (`packages/site`) reads that branch via the Content
Layer API and prerenders every page — real HTML for crawlers and unfurlers.
Re-hosted images are copied into the build and served at `/i/{sha}.webp`, so
the whole thing runs on a free static host with **no object store and no card**.
The only client-side JavaScript is the search box (MiniSearch over a lean index).

## Develop

```bash
npm install
npm test                 # ingest test suite (offline, all GitHub mocked)
npx tsx packages/ingest/src/seed-local.ts   # seed a demo data-branch offline
npm run build:site       # build the static site against ./data-branch
npm --workspace packages/site run preview
```

## Run the real sync locally

```bash
GITHUB_PAT=ghp_xxx npm run sync
```

Cross-repo code search **requires a PAT** — the default Actions `GITHUB_TOKEN`
cannot do it. That's the only credential you need: images are re-hosted into the
data branch's `assets/` and served with the site, so there's no object store to
configure. (If you later want a CDN, set the R2 env vars in
[`.env.example`](.env.example) plus `ASSET_BASE=https://cdn.example.com/i`.)

## Publish a post

Commit `intracloud.md` anywhere in a public repo:

```markdown
---
intracloud: 1
title: How I broke prod
tags: [postmortem]
---

Your markdown here.
```

Only `intracloud` and `title` are required. Author is your GitHub account;
publish date is when Intracloud first sees the file; an update is the file's
bytes changing. No `date`, `slug`, or `author` fields — they'd be gameable.

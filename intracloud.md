---
intracloud: 1
title: Intracloud indexes itself
summary: A blog network with no signup, no forms, and no server — every intracloud.md on public GitHub, rendered as one feed.
tags: [intracloud, meta, static-site]
---

This is the first post on Intracloud, and it lives in the same repo as the code
that indexes it. If you're reading this on **intracloud.tech**, the pipeline
works end to end: discovery found this file, change detection fetched it, the
transform pass ran over it, and a static build prerendered the page you're on.

## How it works

There is no server, no database, and no user auth anywhere in this system.

1. A scheduled GitHub Action searches public GitHub for files named
   `intracloud.md` that contain `intracloud: 1` in their frontmatter.
2. It fetches only the files whose contents changed since last run.
3. It rewrites their images to a CDN, normalizes tags, sanitizes untrusted
   HTML, and force-pushes a data branch.
4. A static [Astro](https://astro.build) site reads that branch and prerenders
   every page — so crawlers and link unfurlers get real HTML.

## Publish your own

Commit a file named `intracloud.md` anywhere in a public repo, with
`intracloud: 1` and a `title` in its frontmatter. That's the entire API.

- Your **author identity** is your GitHub account — avatar and bio for free.
- Your **publish date** is when Intracloud first sees the file. It can't be gamed.
- An **update** is the file's contents changing. Byte truth.

No form. No login. Commit and it appears — within the hour.

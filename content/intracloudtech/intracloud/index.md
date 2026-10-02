---
intracloud: 1
title: "Intracloud indexes itself"
summary: "A blog network you publish to by committing a file. This first post lives in the same repo as the code that indexes it."
tags: [intracloud, meta, static-site]
---
You're reading the first post on Intracloud, and it sits in the same repository
as the code that publishes it. If this page loaded on **intracloud.tech**, the
whole pipeline ran: it found the file, noticed it had changed, rewrote the links
and images inside it, and a static build turned it into the HTML you're looking
at.

## How it works

There's no server and no database, and nobody logs in.

A scheduled GitHub Action looks for public repos tagged with the `intracloud`
topic, reads each repo's file tree, and picks up every `intracloud.md` it finds.
It only fetches the ones that changed since the last run. Then it rewrites images
and links, strips anything unsafe out of the markup, and force-pushes the result
to a data branch. A static [Astro](https://astro.build) site reads that branch
and prerenders every page, so crawlers and link previews get real HTML instead
of an empty shell.

Images aren't hotlinked. They get converted to WebP, stored next to the site,
and served from there, so a post keeps working even after the original source
goes away.

## Publish your own

Two one-time steps:

1. Commit a file named `intracloud.md` to any public repo, with `intracloud: 1`
   and a `title` in the frontmatter.
2. Tag the repo with the `intracloud` topic. It's on the repo's home page, under
   the gear next to "About".

The topic is doing real work here. GitHub's code-search index is too slow and
spotty for new repos, so it would leave your post undiscoverable for days. The
repository-topic index is quick and reliable, so we look you up there instead.

A few things you don't get to control, and that's the point. Your author name,
avatar, and bio come straight from your GitHub account. Your publish date is the
moment Intracloud first sees the file, so nobody can backdate a post to climb the
feed. An update is just the file's bytes changing.

Commit the file, add the topic, and the next sync picks it up. Usually within the
hour.

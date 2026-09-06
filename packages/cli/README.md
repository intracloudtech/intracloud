# @intracloud/cli

Read [Intracloud](https://intracloud.tech) posts from your terminal.

```bash
npx @intracloud/cli            # latest posts
npx @intracloud/cli read 1     # read the first one
```

Or install it:

```bash
npm i -g @intracloud/cli
intracloud search rust
```

## Commands

| Command | What it does |
| --- | --- |
| `intracloud [latest] [-n N]` | list the latest posts |
| `intracloud search <query>` | search titles, summaries, tags, authors |
| `intracloud read <number\|url>` | read a post (number is from the last list) |
| `intracloud open <number\|url>` | open a post in your browser |
| `intracloud author <name>` | posts by a GitHub user |
| `intracloud tag <tag>` | posts with a tag |
| `intracloud tags` | all tags with counts |

## Options

- `--site <url>` — point at another instance (default `https://intracloud.tech`; also `INTRACLOUD_URL`)
- `--json` — machine-readable output
- `-n, --limit N` — how many to list

It reads the public `/feed.json` and each post's raw `.md`, so it needs nothing
but network access. Nothing is written anywhere except a small cache of your last
listing (`~/.cache/intracloud`) so `read <number>` works.

import { z } from "zod";

/**
 * The Intracloud frontmatter contract.
 *
 * There are EXACTLY TWO required fields: `intracloud` and `title`.
 * We fail closed on those two only. Everything else is optional; an optional
 * field with the wrong type produces a warning and is dropped, never a hard
 * failure — otherwise adding a field later would break every existing file.
 *
 * Unknown keys pass through untouched (also with a warning) for the same
 * forward-compatibility reason.
 *
 * There is intentionally NO `date`, `slug`, `authors`, `mirror`, or `lang`.
 * Publish date is `first_seen_at`, author is the repo owner, updated is the
 * blob sha changing. Do not add author-controlled provenance fields.
 */

export const KNOWN_FRONTMATTER_KEYS = [
  "intracloud",
  "title",
  "summary",
  "tags",
  "cover",
  "canonical",
  "draft",
] as const;

export interface Frontmatter {
  /** REQUIRED. Search token + schema version. Always 1 for v1. */
  intracloud: 1;
  /** REQUIRED. */
  title: string;
  summary?: string;
  /** Raw (un-normalized) tags as authored. Normalization happens in ingest. */
  tags?: string[];
  cover?: string;
  canonical?: string;
  draft?: boolean;
  /** Any unknown keys the author included, passed through. */
  [key: string]: unknown;
}

export interface ParseOk {
  ok: true;
  data: Frontmatter;
  warnings: string[];
}

export interface ParseErr {
  ok: false;
  errors: string[];
  warnings: string[];
}

export type ParseResult = ParseOk | ParseErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a raw frontmatter object (as produced by a YAML parser).
 *
 * Fails closed ONLY when `intracloud` or `title` are missing/invalid.
 * All other problems become warnings.
 */
export function parseFrontmatter(raw: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: ["frontmatter is missing or not a mapping"],
      warnings,
    };
  }

  // --- required: intracloud (schema version + search token) ---
  const rawIntracloud = raw.intracloud;
  const intracloudNum =
    typeof rawIntracloud === "number"
      ? rawIntracloud
      : typeof rawIntracloud === "string" && /^\d+$/.test(rawIntracloud.trim())
        ? Number(rawIntracloud.trim())
        : NaN;
  if (rawIntracloud === undefined || rawIntracloud === null) {
    errors.push("missing required field: intracloud");
  } else if (intracloudNum !== 1) {
    errors.push(
      `unsupported schema version: intracloud=${JSON.stringify(rawIntracloud)} (expected 1)`,
    );
  }

  // --- required: title ---
  const rawTitle = raw.title;
  let title: string | undefined;
  if (rawTitle === undefined || rawTitle === null) {
    errors.push("missing required field: title");
  } else if (typeof rawTitle === "string" || typeof rawTitle === "number") {
    title = String(rawTitle).trim();
    if (title.length === 0) errors.push("required field `title` is empty");
  } else {
    errors.push("required field `title` must be a string");
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const data: Frontmatter = {
    intracloud: 1,
    title: title!,
  };

  // --- optional: summary ---
  if (raw.summary !== undefined && raw.summary !== null) {
    if (typeof raw.summary === "string") {
      data.summary = raw.summary.trim();
    } else if (typeof raw.summary === "number") {
      data.summary = String(raw.summary);
    } else {
      warnings.push("`summary` is not a string; ignoring");
    }
  }

  // --- optional: tags ---
  if (raw.tags !== undefined && raw.tags !== null) {
    if (Array.isArray(raw.tags)) {
      const strTags = raw.tags.filter(
        (t): t is string | number =>
          typeof t === "string" || typeof t === "number",
      );
      if (strTags.length !== raw.tags.length) {
        warnings.push("some `tags` entries were not strings; ignoring those");
      }
      data.tags = strTags.map(String);
    } else if (typeof raw.tags === "string") {
      // a single bare tag
      data.tags = [raw.tags];
    } else {
      warnings.push("`tags` is not a list; ignoring");
    }
  }

  // --- optional: cover ---
  if (raw.cover !== undefined && raw.cover !== null) {
    if (typeof raw.cover === "string" && raw.cover.trim().length > 0) {
      data.cover = raw.cover.trim();
    } else {
      warnings.push("`cover` is not a non-empty string; ignoring");
    }
  }

  // --- optional: canonical ---
  if (raw.canonical !== undefined && raw.canonical !== null) {
    const c = String(raw.canonical).trim();
    if (/^https?:\/\/\S+$/.test(c)) {
      data.canonical = c;
    } else {
      warnings.push("`canonical` is not a valid http(s) URL; ignoring");
    }
  }

  // --- optional: draft ---
  if (raw.draft !== undefined && raw.draft !== null) {
    if (typeof raw.draft === "boolean") {
      data.draft = raw.draft;
    } else if (raw.draft === "true" || raw.draft === "false") {
      data.draft = raw.draft === "true";
    } else {
      warnings.push("`draft` is not a boolean; ignoring");
    }
  }

  // --- unknown keys pass through with a warning ---
  for (const key of Object.keys(raw)) {
    if (!(KNOWN_FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      warnings.push(`unknown frontmatter key: ${key} (passed through)`);
      data[key] = raw[key];
    }
  }

  return { ok: true, data, warnings };
}

/** A lint warning surfaced to the author on the post page. */
export const LintWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type LintWarning = z.infer<typeof LintWarningSchema>;

/**
 * The shape of one post record in `feed.json`. This is what the Astro content
 * loader validates. It reuses the frontmatter-derived fields and adds the
 * fields Intracloud computes (identity, timing, change detection, transform).
 */
export const PostSchema = z.object({
  /** `{owner}/{repo}/{path}` — globally unique, structurally collision-free. */
  id: z.string(),
  author: z.string(), // repository.owner.login
  repo: z.string(), // repository.name
  ownerRepo: z.string(), // `{owner}/{repo}`
  path: z.string(), // path to intracloud.md within the repo
  /** Site-relative canonical URL, no trailing slash. */
  url: z.string(),
  /** Raw-source URL (…/post.md). */
  rawUrl: z.string(),

  // --- from frontmatter ---
  title: z.string(),
  summary: z.string().optional(),
  tags: z.array(z.string()), // already normalized + aliased + capped
  cover: z.string().optional(), // rewritten to CDN url when present
  canonical: z.string().optional(),
  draft: z.boolean().default(false),

  // --- computed ---
  first_seen_at: z.string(), // ISO. publish date. never author-supplied.
  updated_at: z.string(), // ISO. bumped when blob sha changes.
  blob_sha: z.string(),
  backfill: z.boolean().default(false),
  /** id of the canonical post when this one is a cross-owner duplicate. */
  duplicate_of: z.string().optional(),
  bodyHash: z.string(),

  /** Rendered, sanitized, asset-rewritten HTML body. */
  html: z.string(),
  /** Rewritten markdown source (assets/links rehosted). */
  markdown: z.string(),

  lint: z.array(LintWarningSchema).default([]),
});
export type Post = z.infer<typeof PostSchema>;

export const FeedSchema = z.object({
  generated_at: z.string(),
  count: z.number(),
  posts: z.array(PostSchema),
});
export type Feed = z.infer<typeof FeedSchema>;

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GithubClient, realSleep, AuthError } from "./github.js";
import { createLogger } from "./logger.js";
import { runSync } from "./sync.js";
import { r2ConfigFromEnv, R2Store, NullStore } from "./r2.js";
import { writeProfileReadme } from "./profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const logger = createLogger();
  const token = process.env.GITHUB_PAT || process.env.GH_PAT;
  if (!token) {
    logger.error("no PAT: set GITHUB_PAT (a fine-grained/classic token). The default Actions GITHUB_TOKEN cannot do cross-repo code search.");
    process.exit(1);
  }

  // repo root is two levels up from packages/ingest/dist or src
  const repoRoot = resolve(__dirname, "..", "..", "..");
  const dataDir = process.env.DATA_DIR || resolve(repoRoot, "data-branch");
  const aliases = await loadJson<Record<string, string>>(
    resolve(repoRoot, "data", "aliases.json"),
    {},
  );
  const blocklist = await loadJson<{ tags: string[]; repos: string[] }>(
    resolve(repoRoot, "data", "blocklist.json"),
    { tags: [], repos: [] },
  );

  const client = new GithubClient({
    fetch: globalThis.fetch,
    sleep: realSleep,
    logger,
    token,
  });

  const r2 = r2ConfigFromEnv();
  const store = r2 ? new R2Store(r2) : new NullStore();
  if (!r2) logger.warn("R2 not configured; images processed but not uploaded (NullStore)");

  try {
    const summary = await runSync(client, store, logger, {
      outDir: dataDir,
      aliases,
      blocklist,
    });

    // regenerate the org .github profile README (latest 10) into the data dir
    await writeProfileReadme(dataDir, summary);

    logger.info("RUN SUMMARY", { ...summary });
  } catch (e) {
    if (e instanceof AuthError) {
      logger.error("AUTH FAILURE — aborting", { error: (e as Error).message });
      process.exit(2);
    }
    logger.error("sync crashed", { error: (e as Error).message });
    process.exit(1);
  }
}

main();

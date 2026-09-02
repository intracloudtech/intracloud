import type { GithubClient } from "./github.js";
import type { Logger } from "./logger.js";
import type { ImageStore } from "./r2.js";
import { processImageBytes } from "./assets.js";
import { MAX_IMAGE_BYTES } from "./config.js";
import type { TransformDeps } from "./transform.js";

/**
 * Fetch bytes for an asset the transform wants to rehost.
 * - repoPath: authenticated contents API (relative images live in the repo).
 * - url:      arbitrary external host, size-capped, best-effort.
 */
export function makeFetchAsset(
  client: GithubClient,
  owner: string,
  repo: string,
): TransformDeps["fetchAsset"] {
  return async ({ url, repoPath }) => {
    if (repoPath !== undefined) {
      return client.fetchContentBytes(owner, repo, repoPath);
    }
    if (url !== undefined) {
      return fetchExternal(url);
    }
    return null;
  };
}

async function fetchExternal(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "intracloud-sync (+https://intracloud.tech)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Build the transform's processImage from the image pipeline + a store. */
export function makeProcessImage(
  store: ImageStore,
  logger: Logger,
): TransformDeps["processImage"] {
  return async (bytes, srcHint) => {
    const processed = await processImageBytes(bytes);
    if (!processed) {
      logger.warn("image skipped (too large or undecodable)", { src: srcHint });
      return null;
    }
    await store.put(processed);
    return { url: processed.url };
  };
}

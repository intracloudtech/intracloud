import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessedImage } from "./assets.js";

/** Where processed images live. Interface so the backend is swappable. */
export interface ImageStore {
  /** Persist if the content-addressed object is not already present. */
  put(img: ProcessedImage): Promise<void>;
}

/**
 * DEFAULT store: write images into the data branch under `assets/`, so they are
 * committed and served as static files with the site. No object store, no
 * billing, no card. Content-addressed → identical images collapse to one file.
 */
export class DataDirStore implements ImageStore {
  private dir: string;
  constructor(outDir: string) {
    this.dir = join(outDir, "assets");
    mkdirSync(this.dir, { recursive: true });
  }
  async put(img: ProcessedImage): Promise<void> {
    const path = join(this.dir, img.filename);
    if (existsSync(path)) return; // content-addressed → already correct bytes
    writeFileSync(path, img.bytes);
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Reads R2 creds from the environment; null if not fully configured. */
export function r2ConfigFromEnv(env = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export class R2Store implements ImageStore {
  private s3: S3Client;
  private seen = new Set<string>();
  constructor(private cfg: R2Config) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  async put(img: ProcessedImage): Promise<void> {
    const key = `i/${img.filename}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    // content-addressed: if it exists, the bytes are identical — skip.
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return;
    } catch {
      // not found → upload
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: img.bytes,
        ContentType: img.contentType,
        // immutable: content-addressed URL never changes → cache a year.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
}

/** Dry-run store: computes URLs but persists nothing. For tests. */
export class NullStore implements ImageStore {
  async put(): Promise<void> {
    /* no-op */
  }
}

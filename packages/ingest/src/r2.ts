import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { ProcessedImage } from "./assets.js";

/** Where processed images live. Interface so we can dry-run without R2. */
export interface ImageStore {
  /** Upload if the content-addressed object is not already present. */
  put(img: ProcessedImage): Promise<void>;
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
    if (this.seen.has(img.key)) return;
    this.seen.add(img.key);
    // content-addressed: if it exists, the bytes are identical — skip.
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: img.key }),
      );
      return;
    } catch {
      // not found → upload
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: img.key,
        Body: img.bytes,
        ContentType: img.contentType,
        // immutable: content-addressed URL never changes → cache a year.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
}

/** Dry-run store: computes URLs but uploads nothing. Used without creds. */
export class NullStore implements ImageStore {
  async put(): Promise<void> {
    /* no-op */
  }
}

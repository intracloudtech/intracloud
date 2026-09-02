import sharp from "sharp";
import { createHash } from "node:crypto";
import { assetBase, IMAGE_MAX_WIDTH, MAX_IMAGE_BYTES } from "./config.js";

export interface ProcessedImage {
  /** content-addressed filename, e.g. `abc123….webp` */
  filename: string;
  /** public url the post body points at (site-relative by default). */
  url: string;
  bytes: Buffer;
  contentType: string;
}

/**
 * Convert arbitrary image bytes to WebP (max 1600px wide), content-address by
 * sha256 of the OUTPUT so identical sources collapse to one immutable object.
 * Returns null when the image is too large or cannot be decoded.
 */
export async function processImageBytes(
  input: Buffer,
): Promise<ProcessedImage | null> {
  if (input.length > MAX_IMAGE_BYTES) return null;
  let out: Buffer;
  try {
    out = await sharp(input, { animated: true, failOn: "none" })
      .rotate() // respect EXIF orientation before dropping metadata
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
  const sha = createHash("sha256").update(out).digest("hex").slice(0, 16);
  const filename = `${sha}.webp`;
  return {
    filename,
    url: `${assetBase()}/${filename}`,
    bytes: out,
    contentType: "image/webp",
  };
}

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImageBytes } from "../src/assets.js";

async function png(w: number, h: number, color = { r: 200, g: 100, b: 50 }) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

describe("processImageBytes", () => {
  it("converts to webp and content-addresses", async () => {
    const p = await processImageBytes(await png(100, 100));
    expect(p).not.toBeNull();
    expect(p!.contentType).toBe("image/webp");
    expect(p!.url).toMatch(/^https:\/\/cdn\.intracloud\.tech\/i\/[0-9a-f]{16}\.webp$/);
  });

  it("identical sources produce identical keys (dedup)", async () => {
    const bytes = await png(64, 64);
    const a = await processImageBytes(Buffer.from(bytes));
    const b = await processImageBytes(Buffer.from(bytes));
    expect(a!.key).toBe(b!.key);
  });

  it("different content produces different keys", async () => {
    const a = await processImageBytes(await png(64, 64, { r: 1, g: 2, b: 3 }));
    const b = await processImageBytes(await png(64, 64, { r: 9, g: 9, b: 9 }));
    expect(a!.key).not.toBe(b!.key);
  });

  it("downscales images wider than 1600px", async () => {
    const p = await processImageBytes(await png(3000, 400));
    const meta = await sharp(p!.bytes).metadata();
    expect(meta.width).toBe(1600);
  });

  it("returns null for oversized input", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    expect(await processImageBytes(big)).toBeNull();
  });

  it("returns null for undecodable bytes", async () => {
    expect(await processImageBytes(Buffer.from("not an image"))).toBeNull();
  });
});

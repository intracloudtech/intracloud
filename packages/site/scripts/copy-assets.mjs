// Copy the data branch's images (assets/) into the site's public/i/ so they
// are served as static files at /i/{sha}.webp alongside the build. Runs as a
// prebuild step. No object store required.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(process.cwd(), "../../data-branch");

const src = resolve(DATA_DIR, "assets");
const dest = resolve(process.cwd(), "public", "i");

rmSync(dest, { recursive: true, force: true });
if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-assets] ${src} → ${dest}`);
} else {
  console.log(`[copy-assets] no assets dir at ${src}; skipping`);
}

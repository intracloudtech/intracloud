import { resolve } from "node:path";

/**
 * The data branch is checked out alongside the repo during build. Point at it
 * with DATA_DIR; defaults to `<repo>/data-branch` (the ingest output dir).
 */
export const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(process.cwd(), "../../data-branch");

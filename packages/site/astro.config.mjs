import { defineConfig } from "astro/config";

// Production domain. Astro derives all absolute URLs (canonical, OG, RSS,
// sitemap) from `site`. No trailing slashes.
export default defineConfig({
  site: "https://intracloud.tech",
  trailingSlash: "never",
  output: "static",
  build: { format: "file" },
  devToolbar: { enabled: false },
  experimental: { contentLayer: true },
});

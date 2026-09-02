import { toHast } from "mdast-util-to-hast";
import { raw } from "hast-util-raw";
import { sanitize, defaultSchema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { parseMdast } from "./markdown.js";

/**
 * Render already-transformed markdown (assets rehosted, links rewritten) to a
 * sanitized HTML body. Defense in depth: even though raw <script>/handlers were
 * stripped in the transform, we sanitize the final hast too.
 */
export function renderHtml(markdown: string): string {
  const mdast = parseMdast(markdown);
  const hast = toHast(mdast, { allowDangerousHtml: true });
  const rawed = raw(hast as any);

  const schema = {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      img: [
        ...(defaultSchema.attributes?.img ?? []),
        "loading",
        "decoding",
        "width",
        "height",
      ],
      a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
      code: [...(defaultSchema.attributes?.code ?? []), "className"],
      span: [...(defaultSchema.attributes?.span ?? []), "className"],
    },
    // allow fenced-code language classes and cdn images through
    clobberPrefix: "ic-",
  };

  const clean = sanitize(rawed, schema as any);
  return toHtml(clean);
}

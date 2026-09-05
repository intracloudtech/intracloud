import { unified } from "unified";
import { toHast } from "mdast-util-to-hast";
import { raw } from "hast-util-raw";
import { sanitize, defaultSchema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import rehypeHighlight from "rehype-highlight";
import { parseMdast } from "./markdown.js";

/**
 * Render already-transformed markdown (assets rehosted, links rewritten) to a
 * sanitized HTML body.
 *
 * Syntax highlighting is class-based (highlight.js via rehype-highlight), done
 * here at build time — no client JS, no inline styles. The `hljs-*` classes are
 * styled by the site's CSS. Sanitization runs AFTER highlighting with a schema
 * that permits those classes but nothing executable, so a stranger's markdown
 * still can't inject scripts or handlers.
 */
export async function renderHtml(markdown: string): Promise<string> {
  const mdast = parseMdast(markdown);
  const hast = raw(toHast(mdast, { allowDangerousHtml: true }) as any);

  // highlight fenced code blocks that declare a language
  const highlighted = (await unified()
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .run(hast as any)) as any;

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
      // class-based syntax highlighting tokens (safe: classes can't execute)
      code: [...(defaultSchema.attributes?.code ?? []), "className"],
      pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
      span: [...(defaultSchema.attributes?.span ?? []), "className"],
    },
    clobberPrefix: "ic-",
  };

  const clean = sanitize(highlighted, schema as any);
  return toHtml(clean as any);
}

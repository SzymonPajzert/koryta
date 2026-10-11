// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@nuxtjs/mdc/runtime";
import { fromHast } from "minimark/hast";
import { parseFrontMatter } from "remark-mdc";
import {
  BLOG_SLUG,
  blogPostMetaSchema,
  validatePostBody,
  type MinimarkBody,
} from "../../shared/blog";

/** Every post under content/blog, held to what the site needs of it.
 *
 * Nuxt Content stores a post whatever it holds, and MDC renders whatever it is
 * handed: a misspelt `::chrat` comes out as an empty element, a series one
 * value short draws a chart with a hole in it, a missing `description` is
 * filled in from the first paragraph. None of that fails a build. This does,
 * in quick-check and in CI, with the line to fix.
 *
 * Parsed the way Nuxt Content parses at build time - MDC's `parseMarkdown`,
 * then `fromHast` into minimark - so the tree checked is the tree served. */

const dir = fileURLToPath(new URL("../../content/blog", import.meta.url));
const entries = readdirSync(dir, { withFileTypes: true });
const posts = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));

describe("content/blog", () => {
  it("holds posts and nothing else", () => {
    // The collection reads `blog/*.md`: a post in a subfolder is silently not
    // a post, and a picture here is not served - those go under public/blog.
    expect(
      entries.filter((e) => !(e.isFile() && e.name.endsWith(".md"))),
    ).toEqual([]);
  });

  it("is not empty, so the checks below check something", () => {
    expect(posts.length).toBeGreaterThan(0);
  });
});

describe.each(posts.map((p) => p.name))("content/blog/%s", (file) => {
  const source = readFileSync(`${dir}/${file}`, "utf8");

  it("is named the way its url will read", () => {
    expect(file.replace(/\.md$/, "")).toMatch(BLOG_SLUG);
  });

  it("says what a post has to say about itself", () => {
    // The front matter as written, not as parsed: the parser makes up a
    // title and a description for a post that has none.
    const { data } = parseFrontMatter(source);
    const result = blogPostMetaSchema.safeParse(data);
    expect(
      result.success
        ? []
        : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    ).toEqual([]);
  });

  it("uses only markdown and the embeds the site has", async () => {
    const parsed = await parseMarkdown(source);
    expect(validatePostBody(fromHast(parsed.body) as MinimarkBody)).toEqual([]);
  });
});

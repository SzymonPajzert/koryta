/**
 * The blog: short pieces on what the data on the site says about the people on
 * it, written in markdown with charts and figures embedded in the text.
 *
 * A post today is a file in `frontend/content/blog/`, which Nuxt Content parses
 * at build time into a tree in its "minimark" format. Everything here works on
 * that tree rather than on the files, so the rules hold for wherever a post
 * comes from next - the plan is posts written on the site by people without
 * push access, parsed on save with the same MDC parser
 * (`parseMarkdown` + `fromHast`, exactly what Nuxt Content runs).
 * `validatePostBody` is the gate that makes that safe: MDC hands `<style>`,
 * `<iframe>` and the rest of html written in markdown straight to the
 * renderer, which escapes only `<script>` and `<base>`.
 *
 * How to write a post is in frontend/README.md, under "Blog".
 */
import { z } from "zod";
import { isoDay } from "./dates";

export const BLOG_PATH = "/blog";

/** A post's file name, which is its url: `/blog/<slug>`. */
export const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The front matter of a post. Nuxt Content stores whatever it is given, so
 * this is what holds a post to it: tests/content/blogPosts.test.ts runs every
 * file through it. */
export const blogPostMetaSchema = z.object({
  title: z.string().trim().min(1),
  /** The lead under the title, the line on /blog, and the link preview. */
  description: z.string().trim().min(1),
  /** The day it went out, `RRRR-MM-DD`. The listing sorts on this string. */
  date: z
    .string()
    .refine((date) => isoDay(date) !== null, "data w formacie RRRR-MM-DD"),
  authors: z.array(z.string().trim().min(1)).min(1),
  tags: z.array(z.string().trim().min(1)).optional(),
  /** The picture a link preview shows: a file under `frontend/public/`. */
  image: z
    .string()
    .startsWith("/", "ścieżka do pliku w frontend/public, od „/”")
    .optional(),
  /** Not listed and not served outside local builds - see README. */
  draft: z.boolean().optional(),
});

export type BlogPostMeta = z.infer<typeof blogPostMetaSchema>;

/** A node of a minimark tree: text, or `[tag, props, ...children]`. */
export type MinimarkNode = string | MinimarkElement;
export type MinimarkElement = [
  string,
  Record<string, unknown>,
  ...MinimarkNode[],
];
export type MinimarkBody = {
  type: "minimark";
  value: MinimarkNode[];
  toc?: unknown;
};

/** A post as /blog lists it. */
export type BlogPostSummary = BlogPostMeta & {
  slug: string;
  path: string;
  draft: boolean;
  readingMinutes: number;
};

/** A post as its own page renders it. */
export type BlogPost = BlogPostSummary & { body: MinimarkBody };

export function slugFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

/** Newest first; drafts only where they are wanted. */
export function listedPosts<
  T extends { date: string; title: string; draft?: boolean },
>(posts: T[], { includeDrafts }: { includeDrafts: boolean }): T[] {
  return posts
    .filter((post) => includeDrafts || !post.draft)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "pl"),
    );
}

const isElement = (node: MinimarkNode): node is MinimarkElement =>
  Array.isArray(node);

function textOf(nodes: MinimarkNode[]): string {
  return nodes
    .map((node) =>
      isElement(node) ? textOf(node.slice(2) as MinimarkNode[]) : node,
    )
    .join(" ");
}

/** Minutes a reader needs, at 200 words a minute. Only the text counts: an
 * embed's data travels in its props, which are not read as words. */
export function readingMinutes(body: MinimarkBody): number {
  const words = textOf(body.value).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** remark-rehype titles the footnotes "Footnotes", hides the title behind an
 * `sr-only` class nothing on the site defines - so it showed anyway - and
 * labels each link back "Back to reference N". Nuxt Content passes it no
 * options to change either, so the tree is put into Polish here instead. */
export function localizeFootnotes(body: MinimarkBody): MinimarkBody {
  const visit = (node: MinimarkNode): MinimarkNode => {
    if (!isElement(node)) return node;
    const [tag, props, ...children] = node;
    if (tag === "h2" && props.id === "footnote-label") {
      return ["h2", { id: "footnote-label" }, "Przypisy"];
    }
    if (tag === "a" && "dataFootnoteBackref" in props) {
      const reference = String(props.ariaLabel ?? "").match(/\d+(?:-\d+)?$/);
      return [
        tag,
        {
          ...props,
          ariaLabel: `Wróć do odwołania${reference ? ` ${reference[0]}` : ""}`,
        },
        ...children.map(visit),
      ];
    }
    return [tag, props, ...children.map(visit)];
  };
  return { ...body, value: body.value.map(visit) };
}

/** A flag written as a bare attribute (`{horizontal}`, which MDC sends as
 * `true`) or spelt out - `stacked=false` arrives as the string "false", which
 * Vue would pass a boolean prop as truthy. */
const flag = z.preprocess(
  (value) =>
    value === "false" ? false : value === "true" || value === "" ? true : value,
  z.boolean().default(false),
);

/** A name on the page. YAML reads `name: 2023` as a number, and a year is a
 * perfectly good name for a series. */
const label = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : value),
  z.string().trim().min(1),
);

/** The palette has eight categorical slots, assigned in a fixed order, and a
 * ninth series would have to be a hue nobody validated. */
const MAX_SERIES = 8;

const chartSchema = z
  .object({
    title: label,
    subtitle: z.string().optional(),
    type: z.enum(["bar", "line"]).default("bar"),
    /** Bars along the y axis, for long category names. */
    horizontal: flag,
    stacked: flag,
    /** What the x axis counts. */
    categories: z.array(label).min(1),
    series: z
      .array(z.object({ name: label, data: z.array(z.number()) }).strict())
      .min(1)
      .max(MAX_SERIES),
    /** Said after every value, as in "12 osób". */
    unit: z.string().optional(),
    /** Where the numbers come from, printed under the chart. */
    source: z.string().optional(),
  })
  .strict()
  .superRefine((chart, ctx) => {
    chart.series.forEach((series, index) => {
      if (series.data.length !== chart.categories.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["series", index, "data"],
          message: `seria „${series.name}” ma ${series.data.length} wartości, a kategorii jest ${chart.categories.length}`,
        });
      }
    });
    if (chart.type === "line" && (chart.horizontal || chart.stacked)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "horizontal i stacked są tylko dla wykresu słupkowego",
      });
    }
  });

/** What each embed a post may use takes. The keys are the names a post writes
 * (`::chart`), and app/utils/blogEmbeds.ts maps each to its component.
 *
 * Strict throughout, so a misspelt key is an error rather than a prop quietly
 * dropped - a `unit` that slipped one level into a series item would
 * otherwise draw the chart without it and say nothing. */
export const blogEmbeds = {
  /** A row of headline numbers. */
  stats: z
    .object({
      items: z
        .array(
          z
            .object({
              label,
              value: z.number(),
              /** After the number: "%", "mln zł". */
              unit: z.string().optional(),
              hint: z.string().optional(),
              tooltip: z.string().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  /** A bar or line chart, with the table of its numbers a click away. */
  chart: chartSchema,
  /** Parts of a whole, as one bar. */
  composition: z
    .object({
      title: z.string().optional(),
      /** Read out in place of the bar; written from the numbers if left out. */
      summary: z.string().optional(),
      segments: z
        .array(z.object({ label, value: z.number().nonnegative() }).strict())
        .min(2)
        .max(MAX_SERIES),
      source: z.string().optional(),
    })
    .strict(),
  /** A boxed aside - a method, a caveat. Its content is the slot. */
  callout: z.object({ title: z.string().optional() }).strict(),
  /** A link to a person's, a company's or an article's page on the site,
   * written as `:entity[Jan Kowalski]{id="…"}`. */
  entity: z.object({ id: label }).strict(),
} satisfies Record<string, z.ZodTypeAny>;

export type BlogEmbedName = keyof typeof blogEmbeds;

export type BlogEmbedProps<N extends BlogEmbedName> = z.output<
  (typeof blogEmbeds)[N]
>;

const isEmbed = (tag: string): tag is BlogEmbedName => tag in blogEmbeds;

/** JSON where MDC wrote JSON, and the value as it is anywhere else. */
function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** An embed's props as the parser left them: a YAML block and a `:bound`
 * attribute arrive as `":key": "<json>"`, a plain attribute as a string.
 * Props the renderer has already decoded pass through unchanged, so a
 * component can run this on what it is given. */
export function readEmbedProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) =>
      key.startsWith(":") ? [key.slice(1), decode(value)] : [key, value],
    ),
  );
}

export function parseEmbedProps<N extends BlogEmbedName>(
  name: N,
  props: Record<string, unknown>,
):
  | { success: true; data: BlogEmbedProps<N> }
  | { success: false; errors: string[] } {
  const result = blogEmbeds[name].safeParse(readEmbedProps(props));
  if (result.success) {
    return { success: true, data: result.data as BlogEmbedProps<N> };
  }
  return {
    success: false,
    errors: result.error.issues.map(
      (issue) =>
        `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
    ),
  };
}

/** The html markdown turns into, footnotes and highlighted code included. A
 * tag outside this list in a post was written by hand, as raw html. */
const MARKDOWN_TAGS = new Set([
  "p",
  "a",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "del",
  "blockquote",
  "code",
  "pre",
  "span",
  "hr",
  "br",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "sup",
  "section",
  "input",
]);

/** Everything wrong with a post's body, as lines a person can act on - an
 * empty list for a post that is fine. */
export function validatePostBody(body: MinimarkBody): string[] {
  const problems: string[] = [];
  const visit = (node: MinimarkNode) => {
    if (!isElement(node)) return;
    const [tag, props, ...children] = node;
    if (tag === "h1") {
      problems.push(
        "Nagłówek „#” w treści: tytuł wpisu jest już nagłówkiem pierwszego stopnia – śródtytuły zaczynaj od „##”.",
      );
    } else if (isEmbed(tag)) {
      const result = parseEmbedProps(tag, props);
      if (!result.success) {
        problems.push(...result.errors.map((error) => `„${tag}”: ${error}`));
      }
    } else if (!MARKDOWN_TAGS.has(tag)) {
      problems.push(
        `Nieznany element „${tag}”. Wpis może używać markdownu i tych osadzeń: ${Object.keys(blogEmbeds).join(", ")}.`,
      );
    }
    children.forEach(visit);
  };
  body.value.forEach(visit);
  return problems;
}

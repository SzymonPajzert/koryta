import { describe, it, expect } from "vitest";
import {
  blogEmbeds,
  blogPostMetaSchema,
  listedPosts,
  localizeFootnotes,
  parseEmbedProps,
  readingMinutes,
  slugFromPath,
  validatePostBody,
  type MinimarkBody,
} from "../../shared/blog";

const body = (...value: MinimarkBody["value"]): MinimarkBody => ({
  type: "minimark",
  value,
});

describe("blogPostMetaSchema", () => {
  const meta = {
    title: "Ilu radnych zasiada w spółkach miejskich",
    description: "Policzyliśmy radnych, którzy pracują w spółkach gmin.",
    date: "2026-10-11",
    authors: ["Szymon Pajzert"],
  };

  it("accepts the four fields every post needs", () => {
    expect(blogPostMetaSchema.safeParse(meta).success).toBe(true);
  });

  it.each(["title", "description", "date", "authors"] as const)(
    "refuses a post without %s",
    (field) => {
      const { [field]: _dropped, ...rest } = meta;
      expect(blogPostMetaSchema.safeParse(rest).success).toBe(false);
    },
  );

  it("refuses a day the calendar does not have", () => {
    // The listing sorts on this string, so "2026-10-1" would sort before
    // "2026-10-09" and a misspelt month would never be caught by eye.
    for (const date of ["2026-10-1", "11.10.2026", "2026-02-31"]) {
      expect(blogPostMetaSchema.safeParse({ ...meta, date }).success).toBe(
        false,
      );
    }
  });

  it("wants an image as a path under public/", () => {
    expect(
      blogPostMetaSchema.safeParse({ ...meta, image: "/blog/a/okladka.png" })
        .success,
    ).toBe(true);
    expect(
      blogPostMetaSchema.safeParse({ ...meta, image: "okladka.png" }).success,
    ).toBe(false);
  });
});

describe("listedPosts", () => {
  const post = (title: string, date: string, draft = false) => ({
    title,
    date,
    draft,
  });

  it("puts the newest first, and orders a shared day by title", () => {
    const listed = listedPosts(
      [
        post("Starszy", "2026-09-01"),
        post("Nowszy b", "2026-10-11"),
        post("Nowszy a", "2026-10-11"),
      ],
      { includeDrafts: false },
    );
    expect(listed.map((p) => p.title)).toEqual([
      "Nowszy a",
      "Nowszy b",
      "Starszy",
    ]);
  });

  it("leaves drafts out unless asked for them", () => {
    const posts = [
      post("Gotowy", "2026-10-01"),
      post("Szkic", "2026-10-02", true),
    ];
    expect(
      listedPosts(posts, { includeDrafts: false }).map((p) => p.title),
    ).toEqual(["Gotowy"]);
    expect(
      listedPosts(posts, { includeDrafts: true }).map((p) => p.title),
    ).toEqual(["Szkic", "Gotowy"]);
  });
});

describe("slugFromPath", () => {
  it("is the last segment of the post's path", () => {
    expect(slugFromPath("/blog/radni-w-spolkach")).toBe("radni-w-spolkach");
  });
});

describe("readingMinutes", () => {
  it("counts the words of the text, not of the embeds' data", () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => "słowo").join(" ");
    const long = body(
      ["p", {}, words(390)],
      // A chart's props are text in the tree, and four hundred numbers in a
      // series are not four hundred words anybody reads.
      ["chart", { ":series": JSON.stringify([{ name: "a", data: [1, 2] }]) }],
      ["p", {}, words(10)],
    );
    expect(readingMinutes(long)).toBe(2);
  });

  it("never says zero", () => {
    expect(readingMinutes(body(["p", {}, "Krótko."]))).toBe(1);
  });
});

describe("localizeFootnotes", () => {
  // What remark-rehype writes under a post with a footnote, verbatim: an
  // English heading hidden behind a class the site does not define, and an
  // English label on every link back.
  const footnotes = body(
    ["p", {}, "Tekst", ["sup", {}, ["a", { href: "#user-content-fn-1" }, "1"]]],
    [
      "section",
      { className: ["footnotes"], dataFootnotes: "" },
      ["h2", { className: ["sr-only"], id: "footnote-label" }, "Footnotes"],
      [
        "ol",
        {},
        [
          "li",
          { id: "user-content-fn-1" },
          "Źródło. ",
          [
            "a",
            {
              href: "#user-content-fnref-1",
              ariaLabel: "Back to reference 1",
              className: ["data-footnote-backref"],
              dataFootnoteBackref: "",
            },
            "↩",
          ],
        ],
      ],
    ],
  );

  it("titles the list in Polish, where a reader can see it", () => {
    const section = localizeFootnotes(footnotes).value[1] as unknown[];
    expect(section[2]).toEqual(["h2", { id: "footnote-label" }, "Przypisy"]);
  });

  it("labels the way back in Polish", () => {
    const section = localizeFootnotes(footnotes).value[1] as unknown[];
    const backref = ((section[3] as unknown[])[2] as unknown[])[3] as [
      string,
      Record<string, unknown>,
    ];
    expect(backref[1].ariaLabel).toBe("Wróć do odwołania 1");
  });

  it("leaves the input alone", () => {
    const before = JSON.stringify(footnotes);
    localizeFootnotes(footnotes);
    expect(JSON.stringify(footnotes)).toBe(before);
  });
});

describe("parseEmbedProps", () => {
  it("decodes the JSON MDC writes for a YAML block", () => {
    const result = parseEmbedProps("stats", {
      ":items": JSON.stringify([{ label: "Osoby", value: 5086 }]),
    });
    expect(result).toEqual({
      success: true,
      data: { items: [{ label: "Osoby", value: 5086 }] },
    });
  });

  it("reads a bare attribute and a written-out false as flags", () => {
    // `::chart{horizontal}` arrives as ":horizontal": "true", and
    // `stacked=false` as the *string* "false" - which Vue would hand a boolean
    // prop as truthy.
    const result = parseEmbedProps("chart", {
      title: "Wykres",
      ":horizontal": "true",
      stacked: "false",
      ":categories": '["A","B"]',
      ":series": '[{"name":"X","data":[1,2]}]',
    });
    expect(result.success && result.data).toMatchObject({
      horizontal: true,
      stacked: false,
    });
  });

  it("takes years for categories, which YAML reads as numbers", () => {
    const result = parseEmbedProps("chart", {
      title: "Wykres",
      ":categories": "[2023, 2024]",
      ":series": '[{"name":"X","data":[1,2]}]',
    });
    expect(result.success && result.data).toMatchObject({
      categories: ["2023", "2024"],
    });
  });

  it("refuses a series whose length is not the number of categories", () => {
    const result = parseEmbedProps("chart", {
      title: "Wykres",
      ":categories": '["A","B","C"]',
      ":series": '[{"name":"X","data":[1,2]}]',
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.errors.join("\n")).toMatch(/X/);
  });

  it("refuses a ninth series - the palette has eight slots", () => {
    const series = Array.from({ length: 9 }, (_, i) => ({
      name: `S${i}`,
      data: [1],
    }));
    const result = parseEmbedProps("chart", {
      title: "Wykres",
      ":categories": '["A"]',
      ":series": JSON.stringify(series),
    });
    expect(result.success).toBe(false);
  });

  it("refuses a key the embed does not take, at any depth", () => {
    // A typo, or a `unit` indented one level too far into a series item.
    const result = parseEmbedProps("chart", {
      title: "Wykres",
      ":categories": '["A"]',
      ":series": '[{"name":"X","data":[1],"unit":"osób"}]',
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.errors.join("\n")).toMatch(/unit/);
  });

  it("refuses a number written as text", () => {
    const result = parseEmbedProps("stats", {
      ":items": JSON.stringify([{ label: "Osoby", value: "5 086" }]),
    });
    expect(result.success).toBe(false);
  });
});

describe("validatePostBody", () => {
  it("passes markdown and the embeds it knows", () => {
    expect(
      validatePostBody(
        body(
          ["h2", { id: "a" }, "Śródtytuł"],
          ["p", {}, "Tekst o ", ["entity", { id: "1" }, "Janie"], "."],
          ["stats", { ":items": '[{"label":"Osoby","value":3}]' }],
          ["callout", { title: "Metodologia" }, ["p", {}, "Jak liczyliśmy."]],
        ),
      ),
    ).toEqual([]);
  });

  it("names an embed it does not know", () => {
    const problems = validatePostBody(body(["wykres", {}]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/wykres/);
  });

  it("refuses raw html that would run or restyle the page", () => {
    // MDC passes `<style>` and `<iframe>` written in markdown through to the
    // page; its renderer escapes only `<script>` and `<base>`. A post in the
    // repository is reviewed, but the same check is what will stand between
    // an author without push access and the page.
    for (const tag of ["script", "style", "iframe"]) {
      expect(validatePostBody(body([tag, {}, "x"]))).toHaveLength(1);
    }
  });

  it("refuses a first-level heading, which the title already is", () => {
    expect(validatePostBody(body(["h1", { id: "a" }, "Tytuł"]))).toEqual([
      expect.stringMatching(/##/),
    ]);
  });

  it("reports an embed's bad props with where they are", () => {
    const problems = validatePostBody(
      body(["stats", { ":items": '[{"label":"Osoby"}]' }]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/stats/);
    expect(problems[0]).toMatch(/items\.0\.value/);
  });

  it("knows every embed it validates", () => {
    expect(Object.keys(blogEmbeds).sort()).toEqual([
      "callout",
      "chart",
      "composition",
      "entity",
      "stats",
    ]);
  });
});

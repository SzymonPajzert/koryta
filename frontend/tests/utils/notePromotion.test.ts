import { describe, it, expect, vi } from "vitest";
import type { NoteSource } from "~~/shared/model";
import {
  articleIdsForSources,
  sourcesToPromote,
  withArticleIds,
} from "~/utils/notePromotion";

const source = (overrides: Partial<NoteSource> = {}): NoteSource => ({
  note: "Ciekawe",
  url: "https://example.pl/a",
  kind: "source",
  ...overrides,
});

describe("sourcesToPromote", () => {
  it("takes source entries that carry a url", () => {
    expect(sourcesToPromote([source()])).toHaveLength(1);
  });

  it("takes entries written before kinds existed", () => {
    expect(sourcesToPromote([source({ kind: undefined })])).toHaveLength(1);
  });

  it("leaves corrections and gap reports alone", () => {
    expect(
      sourcesToPromote([
        source({ kind: "change_request" }),
        source({ kind: "missing" }),
      ]),
    ).toEqual([]);
  });

  it("leaves an entry with no url, or a blank one", () => {
    expect(
      sourcesToPromote([source({ url: undefined }), source({ url: "  " })]),
    ).toEqual([]);
  });

  it("leaves an entry that is already an article", () => {
    expect(sourcesToPromote([source({ articleNodeId: "a1" })])).toEqual([]);
  });
});

describe("withArticleIds", () => {
  it("attaches the node each url became", () => {
    const sources = [source(), source({ url: "https://example.pl/b" })];
    const updated = withArticleIds(sources, new Map([["example.pl/a", "a1"]]));
    expect(updated).toEqual([
      { ...sources[0], articleNodeId: "a1" },
      sources[1],
    ]);
  });

  it("attaches it however the entry spelled the url", () => {
    // The server matches an existing article normalized, so all three of these
    // are the one page and all three have to end up pointing at it.
    const sources = [
      source({ url: "https://www.example.pl/a/" }),
      source({ url: "example.pl/a" }),
      source({ url: "  https://example.pl/a  " }),
    ];
    const updated = withArticleIds(sources, new Map([["example.pl/a", "a1"]]));
    expect(updated?.map((s) => s.articleNodeId)).toEqual(["a1", "a1", "a1"]);
  });

  it("says nothing changed when nothing did", () => {
    expect(withArticleIds([source()], new Map())).toBeNull();
    expect(
      withArticleIds(
        [source({ articleNodeId: "a1" })],
        new Map([["example.pl/a", "a1"]]),
      ),
    ).toBeNull();
  });
});

describe("articleIdsForSources", () => {
  it("asks once per page, however many entries cite it", async () => {
    const articleIdFor = vi.fn(async () => "a1");
    const ids = await articleIdsForSources(
      [source(), source({ note: "I jeszcze to" })],
      articleIdFor,
    );

    expect(articleIdFor).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(new Map([["example.pl/a", "a1"]]));
  });

  it("asks once for one page cited under two spellings", async () => {
    // Two requests would be two concurrent creates of the same article, and
    // the server dedupes by reading before it writes - so both would miss and
    // both would write. One node, one request.
    const articleIdFor = vi.fn(async () => "a1");
    const ids = await articleIdsForSources(
      [source({ url: "https://www.example.pl/a/" }), source()],
      articleIdFor,
    );

    expect(articleIdFor).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(new Map([["example.pl/a", "a1"]]));
  });

  it("asks with the url the author typed, not the normalized one", async () => {
    // That address is what the article is stored under and what a reader
    // follows; normalizing is only how two of them are told to be one page.
    const articleIdFor = vi.fn(async () => "a1");
    await articleIdsForSources(
      [source({ url: "https://www.example.pl/a/" })],
      articleIdFor,
    );

    expect(articleIdFor).toHaveBeenCalledWith("https://www.example.pl/a/");
  });

  it("does not ask when there is nothing to promote", async () => {
    const articleIdFor = vi.fn(async () => "a1");
    expect(
      await articleIdsForSources([source({ kind: "missing" })], articleIdFor),
    ).toEqual(new Map());
    expect(articleIdFor).not.toHaveBeenCalled();
  });

  it("keeps the pages that worked when one url fails", async () => {
    const articleIdFor = vi.fn(async (url: string) => {
      if (url === "https://example.pl/a") throw new Error("502");
      return "b1";
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const ids = await articleIdsForSources(
      [source(), source({ url: "https://example.pl/b" })],
      articleIdFor,
    );

    // The failed one is simply absent, so the entry keeps no id and the next
    // save tries it again.
    expect(ids).toEqual(new Map([["example.pl/b", "b1"]]));
  });
});

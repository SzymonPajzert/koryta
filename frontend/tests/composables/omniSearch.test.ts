import { describe, it, expect } from "vitest";
import { omniSearchTarget } from "../../app/composables/omniSearch";

describe("omniSearchTarget", () => {
  // A profile opened from the revision queue carries `?revisionId=`, and the
  // view renders that revision on top of the node. A search made from there has
  // to leave it behind, or the next profile shows the previous person's
  // proposal and the search looks like it never navigated.
  it("drops the current query when the pick leads to another page", () => {
    expect(
      omniSearchTarget(
        { path: "/osoba/jan-kowalski-1", query: { revisionId: "rev1" } },
        { path: "/osoba/anna-nowak-2" },
      ),
    ).toEqual({ path: "/osoba/anna-nowak-2", query: {} });
  });

  it("keeps the current query when the pick refines the same page", () => {
    expect(
      omniSearchTarget(
        { path: "/eksploruj/tabela", query: { miejsce: "krakow" } },
        { path: "/eksploruj/tabela", query: { party: "PiS" } },
      ),
    ).toEqual({
      path: "/eksploruj/tabela",
      query: { miejsce: "krakow", party: "PiS" },
    });
  });

  // „Lista wszystkich osób” leads to the table and asks for nothing narrower, so
  // on a filtered table the filters are what stands between the reader and the
  // list it promises. They stayed, and on a table showing „Brak danych” the pick
  // changed nothing a reader could see.
  it("drops the filters of the page open for an entry with no query of its own", () => {
    expect(
      omniSearchTarget(
        { path: "/eksploruj/tabela", query: { party: "PO", teryt: "1661" } },
        { path: "/eksploruj/tabela" },
      ),
    ).toEqual({ path: "/eksploruj/tabela", query: {} });
  });

  // The same rule for a hit on the person whose page is open: what was asked for
  // is their page, not the proposal a link from the revision queue laid over it.
  it("opens the page afresh when the pick is the page open", () => {
    expect(
      omniSearchTarget(
        { path: "/osoba/jan-kowalski-1", query: { revisionId: "rev1" } },
        { path: "/osoba/jan-kowalski-1" },
      ),
    ).toEqual({ path: "/osoba/jan-kowalski-1", query: {} });
  });

  it("stays put, filters and all, for a pick with no path of its own", () => {
    expect(
      omniSearchTarget(
        { path: "/graf", query: { partia: "PiS" } },
        { query: { miejsce: "krakow" } },
      ),
    ).toEqual({ path: "/graf", query: { partia: "PiS", miejsce: "krakow" } });
  });

  it("sends a pick the site cannot show to the table", () => {
    expect(
      omniSearchTarget(
        { path: "/admin/rewizje/node1", query: { revisionId: "rev1" } },
        { path: "/admin/rewizje/node2" },
      ),
    ).toEqual({ path: "/eksploruj/tabela", query: {} });
  });
});

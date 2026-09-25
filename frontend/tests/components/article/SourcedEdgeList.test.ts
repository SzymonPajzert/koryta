import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import SourcedEdgeList from "../../../app/components/article/SourcedEdgeList.vue";
import type { SourcedEdge } from "~~/server/api/edges/byReference.get";

const edge = (overrides: Partial<SourcedEdge> = {}): SourcedEdge => ({
  id: "edge-1",
  type: "employed",
  name: "prezes zarządu",
  source: "jan",
  target: "pkp",
  sourceName: "Jan Kowalski",
  targetName: "PKP Intercity",
  sourceType: "person",
  targetType: "place",
  start_date: "2024-03-01",
  published: true,
  references: ["article-1"],
  ...overrides,
});

const mountList = (edges: SourcedEdge[], canEdit = false) =>
  mountSuspended(SourcedEdgeList, { props: { edges, canEdit } });

/** The chips standing for a relation's ends, as components: the test router
 * resolves no routes, so a chip's `to` never makes it into an `href` here. */
const endChips = (wrapper: Awaited<ReturnType<typeof mountList>>) =>
  wrapper
    .findAllComponents({ name: "VChip" })
    .filter((chip) => chip.attributes("data-testid") === "article-sourced-end");

describe("ArticleSourcedEdgeList", () => {
  it("draws both ends of a relation as chips linking to their pages", async () => {
    const wrapper = await mountList([edge()]);

    const ends = wrapper.findAll('[data-testid="article-sourced-end"]');
    expect(ends.map((end) => end.text())).toEqual([
      "Jan Kowalski",
      "PKP Intercity",
    ]);
    for (const end of ends) {
      expect(end.classes()).toContain("v-chip");
      // The kind of page it leads to, the same icon the mention chips carry.
      expect(end.find(".v-chip__prepend .v-icon").exists()).toBe(true);
    }
    expect(endChips(wrapper).map((chip) => chip.props("to"))).toEqual([
      "/osoba/jan-kowalski-jan",
      "/instytucja/pkp-intercity-pkp",
    ]);
  });

  it("leaves no bare link in the section", async () => {
    // What the report was about: each end was a plain `<a>`, drawn in the
    // browser's blue, inside a card per relation.
    const wrapper = await mountList([edge(), edge({ id: "edge-2" })], true);

    const links = wrapper.findAll("a");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.classes()).toContain("v-chip");
    }
    expect(wrapper.find(".v-card").exists()).toBe(false);
  });

  it("puts the relation, its dates and its status on the same row", async () => {
    const wrapper = await mountList([
      edge({ published: false, references: ["article-1", "article-2"] }),
    ]);

    const row = wrapper.get('[data-testid="sourced-edge-edge-1"]');
    expect(row.text()).toContain("prezes zarządu");
    expect(row.text()).toContain("2024-03-01 – obecnie");
    expect(row.text()).toContain("szkic");
    expect(row.text()).toContain("2 źródła");
  });

  it("names an end whose page is gone, without linking it", async () => {
    const wrapper = await mountList([
      edge({ targetName: null, targetType: null }),
    ]);

    const ends = endChips(wrapper);
    expect(ends[1]!.text()).toBe("pkp");
    expect(ends[1]!.props("to")).toBeUndefined();
  });

  it("offers detaching the source to a signed in reader only", async () => {
    const reader = await mountList([edge()]);
    expect(
      reader.find('[data-testid="sourced-edge-detach-edge-1"]').exists(),
    ).toBe(false);

    const editor = await mountList([edge()], true);
    const detach = editor.get('[data-testid="sourced-edge-detach-edge-1"]');
    expect(detach.attributes("aria-label")).toBe("Odepnij źródło");
    await detach.trigger("click");
    expect(editor.emitted("detach")?.[0]?.[0]).toMatchObject({ id: "edge-1" });
  });

  it("says so when nothing rests on the article", async () => {
    const wrapper = await mountList([]);
    expect(wrapper.text()).toContain(
      "Żadne powiązanie nie powołuje się jeszcze na ten artykuł.",
    );
  });
});

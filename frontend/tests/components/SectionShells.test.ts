import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import ArticleCitedNotes from "../../app/components/article/CitedNotes.vue";
import MentionArticleList from "../../app/components/mention/ArticleList.vue";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref({ uid: "test-user-id" }) })),
  authRequest: vi.fn(async () => ({
    notes: [
      {
        key: "n1",
        nodeId: "p1",
        nodeName: "Jan Kowalski",
        nodeType: "person",
        kind: "source",
        note: "Wzmianka o powołaniu do rady nadzorczej.",
        createdAt: "2026-05-01T00:00:00Z",
      },
    ],
  })),
  authFetch: vi.fn(() => ({
    data: ref({
      mentions: [
        {
          edgeId: "e1",
          nodeId: "a1",
          name: "Artykuł o radzie",
          sourceURL: "https://example.org/rada",
          publishedDate: "2026-05-01",
        },
      ],
    }),
  })),
}));

vi.mock("~/composables/useDomainIcon", () => ({
  useDomainIcon: () => ({ getDomainIcon: () => "" }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** Both sections are drawn through `PageSection` now, so what used to be a
 * private copy of the heading rules is the shared one: an `h2.text-h6` with
 * the section's icon in front of it, and the explanation either in a `k-lead`
 * paragraph or behind the heading's „(i)”. */
describe("sections drawn through PageSection", () => {
  it("cited notes: heading, count, lead and the note", async () => {
    const wrapper = await mountSuspended(ArticleCitedNotes, {
      props: { nodeId: "a1" },
    });
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="cited-note"]').exists()).toBe(true),
    );
    const section = wrapper.get('[data-testid="article-cited-notes"]');
    expect(section.get("h2").classes()).toContain("text-h6");
    expect(section.get("h2").text()).toBe("Notatki z innych stron");
    expect(section.find(".sec-head__icon").exists()).toBe(true);
    expect(section.get(".sec-head .v-chip").text()).toBe("1");
    // The lead moved behind the heading's „(i)”: two explanatory paragraphs
    // stacked above the article's own notes is the bloat that got reported.
    expect(section.find("p.k-lead").exists()).toBe(false);
    await section.get("[data-testid='section-info']").trigger("click");
    expect(document.body.textContent).toContain("Co czytelnicy zapisali");
    expect(section.text()).toContain("Jan Kowalski");
  });

  it("mentions: heading, and where the articles come from behind the (i)", async () => {
    const wrapper = await mountSuspended(MentionArticleList, {
      props: { nodeId: "p1" },
    });
    const section = wrapper.get('[data-testid="node-mentions"]');
    // No margin of its own: the entity page that stacks it (`k-sections`)
    // owns the gap above it, and a margin here would add to that.
    expect(section.classes().filter((c) => /^m[tby]?-/.test(c))).toEqual([]);
    expect(section.get("h2").text()).toBe("Artykuły, które o tym wspominają");
    // No icon beside the heading, and no lead under it: the cards say what
    // they are, and the sentence on where they come from is a click away.
    expect(
      section.find(".sec-head > .sec-head__icon:not(.sec-head__info)").exists(),
    ).toBe(false);
    expect(section.find("p.k-lead").exists()).toBe(false);
    expect(section.find('[data-testid="node-mentions-lead"]').exists()).toBe(
      false,
    );
    await section.get("[data-testid='section-info']").trigger("click");
    expect(
      document.querySelector('[data-testid="node-mentions-lead"]')?.textContent,
    ).toContain("Teksty prasowe, w których pada ta nazwa");
    expect(section.find('[data-testid="node-mention-card"]').exists()).toBe(
      true,
    );
  });
});

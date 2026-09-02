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
 * private copy of the heading rules is the shared one: an `h3.text-h6` with
 * the section's icon in front of it, and the lead in a `k-lead` paragraph. */
describe("sections drawn through PageSection", () => {
  it("cited notes: heading, count, lead and the note", async () => {
    const wrapper = await mountSuspended(ArticleCitedNotes, {
      props: { nodeId: "a1" },
    });
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="cited-note"]').exists()).toBe(true),
    );
    const section = wrapper.get('[data-testid="article-cited-notes"]');
    expect(section.get("h3").classes()).toContain("text-h6");
    expect(section.get("h3").text()).toBe("Notatki z innych stron");
    expect(section.find(".sec-head__icon").exists()).toBe(true);
    expect(section.get(".sec-head .v-chip").text()).toBe("1");
    expect(section.get("p.k-lead").text()).toContain("Co czytelnicy zapisali");
    expect(section.text()).toContain("Jan Kowalski");
  });

  it("mentions: heading, icon and the lead with its testid", async () => {
    const wrapper = await mountSuspended(MentionArticleList, {
      props: { nodeId: "p1" },
    });
    const section = wrapper.get('[data-testid="node-mentions"]');
    expect(section.classes()).toContain("mt-4");
    expect(section.get("h3").text()).toBe("Artykuły, które o tym wspominają");
    expect(section.find(".sec-head__icon").exists()).toBe(true);
    expect(
      section.get('[data-testid="node-mentions-lead"]').classes(),
    ).toContain("k-lead");
    expect(section.find('[data-testid="node-mention-card"]').exists()).toBe(
      true,
    );
  });
});

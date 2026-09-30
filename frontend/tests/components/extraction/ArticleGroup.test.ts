import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ArticleGroup from "../../../app/components/extraction/ArticleGroup.vue";
import type { ExtractionFact } from "../../../shared/model";

/** The vote buttons on an opened card subscribe to its vote document; the
 * subscription is not what these tests are about. */
vi.mock("~/composables/votes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/votes")>()),
  useVotes: () => ({ userCategoryVotes: ref({}), castVote: vi.fn() }),
}));

const facts = [
  {
    id: "fact-1",
    url: "example.com/fundacja",
    articleUrl: "example.com/fundacja",
    articleDomain: "example.com",
    justification: "Łukasz Nieprzypisany, prezes Fundacji Bez Stron",
    fact_type: "employment",
    person: "Łukasz Nieprzypisany",
    organization: "Fundacja Bez Stron",
    role: "prezes",
    tag: "v26",
  } as ExtractionFact,
];

const mount = (open?: boolean) =>
  mountSuspended(ArticleGroup, {
    props: {
      url: "example.com/fundacja",
      domain: "example.com",
      facts,
      ...(open === undefined ? {} : { open }),
    },
  });

describe("ExtractionArticleGroup", () => {
  it("starts closed, so a long list holds no card it is not showing", async () => {
    const group = await mount();
    expect(group.findAll(".extraction-card")).toHaveLength(0);
    expect(group.text()).toContain("1");
  });

  it("starts open where it was asked to - one article's facts, came for", async () => {
    // /ekstrakcje?article=, where the search box sends a reader for a name
    // only an unmatched fact carries.
    const group = await mount(true);
    expect(group.findAll(".extraction-card")).toHaveLength(1);
    expect(group.text()).toContain("Fundacja Bez Stron");
  });
});

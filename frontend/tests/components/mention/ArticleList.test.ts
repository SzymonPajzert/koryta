import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick, ref } from "vue";
import MentionArticleList from "../../../app/components/mention/ArticleList.vue";
import type {
  NodeMention,
  NodeMentions,
} from "~~/server/api/nodes/[id]/mentions.get";

/** What the endpoint answered, swapped by a test to stand for a refetch - the
 * query switches to `latest` once the client learns the reader is signed in. */
const data = ref<NodeMentions | null>(null);

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref(null) })),
  authFetch: vi.fn(() => ({ data })),
}));

const mention = (
  nodeId: string,
  edgeId: string,
  extra: Partial<NodeMention> = {},
): NodeMention => ({
  edgeId,
  nodeId,
  name: `Artykuł ${nodeId}`,
  sourceURL: `https://example.pl/${nodeId}`,
  publishedDate: null,
  published: true,
  ...extra,
});

const mountList = () =>
  mountSuspended(MentionArticleList, { props: { nodeId: "p1" } });

const cardNames = (wrapper: Awaited<ReturnType<typeof mountList>>) =>
  wrapper
    .findAll('[data-testid="node-mention-card"]')
    .map((card) => card.find(".font-weight-medium").text());

describe("MentionArticleList", () => {
  it("draws the list it is given again, card for card, after a refetch", async () => {
    // One relation citing two articles gives two cards carrying the same edge
    // id - the endpoint dedupes per article, not per edge. Keyed on the edge,
    // Vue matched both old cards to one new one when the list reordered,
    // mounted a fresh card for the other and left an orphan behind: one
    // article drawn twice.
    data.value = {
      mentions: [
        mention("x", "m1"),
        mention("a1", "e1"),
        mention("a2", "e1"),
        mention("y", "m2"),
      ],
    };
    const wrapper = await mountList();
    expect(cardNames(wrapper)).toEqual([
      "Artykuł x",
      "Artykuł a1",
      "Artykuł a2",
      "Artykuł y",
    ]);

    data.value = {
      mentions: [
        mention("y", "m2"),
        mention("a2", "e1"),
        mention("a1", "e1"),
        mention("x", "m1"),
      ],
    };
    await nextTick();

    expect(cardNames(wrapper)).toEqual([
      "Artykuł y",
      "Artykuł a2",
      "Artykuł a1",
      "Artykuł x",
    ]);
  });
});

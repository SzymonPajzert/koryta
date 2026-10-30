import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import MentionArticleList from "../../../app/components/mention/ArticleList.vue";
import type {
  NodeMention,
  NodeMentions,
} from "~~/server/api/nodes/[id]/mentions.get";
import type { PersonDeclarations } from "~~/shared/declarations";

/** What the endpoint answered, swapped by a test to stand for a refetch - the
 * query switches to `latest` once the client learns the reader is signed in. */
const data = ref<NodeMentions | null>(null);

/** A person's declarations (`/api/nodes/<id>/declarations`), by node; any
 * other node gets the endpoint's 404. */
const { mockAuthRequest, declarationsOf } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  declarationsOf: new Map<string, unknown>(),
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref(null) })),
  authFetch: vi.fn(() => ({ data })),
  authRequest: mockAuthRequest,
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

const STRZELIN = "Strzelin (gmina miejsko-wiejska)";

/** Two declarations, older first, as the endpoint may send them. */
const twoDeclarations: PersonDeclarations = {
  autoPublished: { at: "2026-10-29T08:15:00.000Z" },
  declarations: [
    {
      url: "https://www.bip.example.pl/oswiadczenie-2023.pdf",
      year: 2023,
      unit: STRZELIN,
      office: "Rada gminy",
    },
    {
      url: "https://bip.example.pl/oswiadczenie-2024.pdf",
      year: 2024,
      unit: STRZELIN,
      office: "Rada gminy",
    },
  ],
};

/** A person's page: the list with their declarations. Each test mounts its
 * own node, since the declarations are fetched under the node's key and a
 * key another test filled would answer with that test's data. */
async function mountPersonList(nodeId: string) {
  const wrapper = await mountSuspended(MentionArticleList, {
    props: { nodeId, withDeclarations: true },
  });
  await flushPromises();
  return wrapper;
}

type ListWrapper = Awaited<ReturnType<typeof mountPersonList>>;

const title = (wrapper: ListWrapper) =>
  wrapper.get('[data-testid="node-mentions"] h3').text();

/** Each card of the section, in order: a declaration or an article. A column
 * given `cols` is `.v-col-12`, not `.v-col`, so a column is any child. */
const cardKinds = (wrapper: ListWrapper) =>
  wrapper
    .findAll('[data-testid="node-mentions"] .v-row > div')
    .map((col) =>
      col.attributes("data-testid") === "person-declarations"
        ? "oświadczenie"
        : col.find('[data-testid="node-mention-card"]').exists()
          ? "artykuł"
          : "?",
    );

describe("MentionArticleList on a person's page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.value = null;
    declarationsOf.clear();
    mockAuthRequest.mockImplementation(async (url: string) => {
      const node = /^\/api\/nodes\/([^/]+)\/declarations$/.exec(url)?.[1];
      const found = node ? declarationsOf.get(node) : undefined;
      if (found) return found;
      throw Object.assign(new Error("Page not found"), { statusCode: 404 });
    });
  });

  it("puts the declarations first, under „Prasa i dokumenty” beside articles", async () => {
    // The title for the two together, from round bip-osoba-r2.
    declarationsOf.set("both", twoDeclarations);
    data.value = { mentions: [mention("x", "m1"), mention("y", "m2")] };
    const list = await mountPersonList("both");

    expect(title(list)).toBe("Prasa i dokumenty");
    expect(cardKinds(list)).toEqual([
      "oświadczenie",
      "oświadczenie",
      "artykuł",
      "artykuł",
    ]);
    // The header's line points here.
    expect(list.get('[data-testid="node-mentions"]').attributes("id")).toBe(
      "oswiadczenia-majatkowe",
    );
    // What the section holds, one sentence each.
    const lead = list.get('[data-testid="node-mentions-lead"]').text();
    expect(lead).toContain("Teksty prasowe, w których pada ta nazwa");
    expect(lead).toContain(
      "Oświadczenia majątkowe z BIP mają tę samą datę urodzenia co ta strona.",
    );
  });

  it("takes a declaration out to its BIP, newest first", async () => {
    declarationsOf.set("out", twoDeclarations);
    const list = await mountPersonList("out");

    const cards = list.findAll('[data-testid="person-declarations"]');
    expect(
      cards.map((card) => card.find(".font-weight-medium").text()),
    ).toEqual([
      "Oświadczenie majątkowe za 2024",
      "Oświadczenie majątkowe za 2023",
    ]);
    // Out of the site, in a new tab: a declaration has no page of ours.
    const link = cards[0]!.get("a");
    expect(link.attributes("href")).toBe(
      "https://bip.example.pl/oswiadczenie-2024.pdf",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
    expect(link.attributes("aria-label")).toBe(
      "Oświadczenie majątkowe za 2024, Rada gminy · Strzelin (gmina miejsko-wiejska), bip.example.pl, otwiera się w nowej karcie",
    );
    // The office before the unit, then the host, without its www.
    expect(cards[1]!.text()).toContain(
      "Rada gminy · Strzelin (gmina miejsko-wiejska)",
    );
    expect(cards[1]!.text()).toContain("· bip.example.pl");
    expect(cards[1]!.text()).not.toContain("www.");
  });

  it("calls the section after the declarations when there is nothing else", async () => {
    declarationsOf.set("two", twoDeclarations);
    declarationsOf.set("one", {
      autoPublished: null,
      declarations: [twoDeclarations.declarations[1]!],
    });

    expect(title(await mountPersonList("two"))).toBe("Oświadczenia majątkowe");
    const one = await mountPersonList("one");
    expect(title(one)).toBe("Oświadczenie majątkowe");
    expect(one.get('[data-testid="node-mentions-lead"]').text()).toBe(
      "Oświadczenie majątkowe z BIP ma tę samą datę urodzenia co ta strona.",
    );
  });

  it("keeps the articles' own title when there are no declarations", async () => {
    data.value = { mentions: [mention("x", "m1")] };
    const list = await mountPersonList("none");

    expect(title(list)).toBe("Artykuły, które o tym wspominają");
    expect(cardKinds(list)).toEqual(["artykuł"]);
    expect(
      list.get('[data-testid="node-mentions"]').attributes("id"),
    ).toBeUndefined();
  });

  it("draws nothing for a person with neither", async () => {
    const list = await mountPersonList("nothing");

    expect(list.find('[data-testid="node-mentions"]').exists()).toBe(false);
  });

  it("does not ask for declarations on a place's page", async () => {
    data.value = { mentions: [mention("x", "m1")] };
    const list = await mountSuspended(MentionArticleList, {
      props: { nodeId: "place" },
    });
    await flushPromises();

    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(title(list)).toBe("Artykuły, które o tym wspominają");
  });
});

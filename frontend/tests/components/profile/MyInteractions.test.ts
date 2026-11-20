import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import MyInteractions from "../../../app/components/profile/MyInteractions.vue";
import { emptyProposalCounts, type Proposal } from "~~/shared/proposals";
import type {
  Interaction,
  MyInteractions as Response,
} from "~~/server/api/interactions/mine.get";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: { value: { uid: "u1", emailVerified: true } },
    userConfig: { data: { value: {} } },
  }),
}));

const vuetify = createVuetify({ components, directives });

/** Nuxt resolves these at build time; a bare mount has to be handed them. The
 * link stub keeps the class it is given, which is the half of it under test. */
const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: "" } },
  setup(props, { slots }) {
    return () => h("a", { href: String(props.to) }, slots.default?.());
  },
});

const stubs = {
  NuxtLink: NuxtLinkStub,
  ChipRevisionStatus: true,
  RevisionDiff: true,
};

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "rev1",
  targetId: "n1",
  targetCollection: "nodes",
  targetName: "Jan Kowalski",
  targetType: "person",
  targetPath: "/osoba/n1",
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [],
  changeCount: 1,
  updateTime: "2026-08-20T10:00:00.000Z",
  updateUser: "u1",
  author: null,
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  stale: false,
  subject: {
    id: "n1",
    name: "Jan Kowalski",
    type: "person",
    path: "/osoba/n1",
    published: true,
  },
  ...over,
});

const asItem = (row: Proposal): Interaction => ({
  kind: "proposal",
  at: row.updateTime ?? "",
  proposal: row,
});

const vote = (
  over: Partial<Extract<Interaction, { kind: "vote" }>["vote"]> = {},
): Interaction => {
  const row = {
    nodeId: "p1",
    name: "Anna Nowak",
    path: "/osoba/anna-nowak-p1",
    value: 3,
    updatedAt: "2026-08-21T10:00:00.000Z",
    ...over,
  };
  return { kind: "vote", at: row.updatedAt, vote: row };
};

const respond = (over: Partial<Response> = {}): Response => ({
  items: [asItem(proposal())],
  total: 3,
  counts: { ...emptyProposalCounts(), pending: 2, approved: 1, votes: 0 },
  truncated: { proposals: false, votes: false },
  ...over,
});

const mountCard = async () => {
  const wrapper = mount(MyInteractions, {
    global: { plugins: [vuetify], stubs },
  });
  await flushPromises();
  return wrapper;
};

/** A vote row's verdict: the number and the words after it. */
const verdictOf = (row: { get: (selector: string) => { element: Element } }) =>
  (row.get("strong").element.parentElement?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** The query of the nth call to the endpoint. */
const queryOf = (call: number) =>
  (mockAuthRequest.mock.calls[call]?.[1] as { query: Record<string, unknown> })
    .query;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthRequest.mockResolvedValue(respond());
});

describe("MyInteractions", () => {
  it("renders the entry name as body text, not as a browser-default link", async () => {
    const wrapper = await mountCard();

    const link = wrapper.get('a[href="/osoba/n1?revisionId=rev1"]');
    // The class carries `color: inherit` and drops the underline; without it
    // every row renders as a blue underlined anchor, which is what the card
    // looked like when it was reported. Defined once in app.vue and shared
    // with the review queue, so the two cannot drift apart.
    expect(link.classes()).toContain("link-plain");
  });

  it("asks for everything until a status is chosen", async () => {
    await mountCard();

    expect(queryOf(0)).toMatchObject({ page: 1, filter: "all" });
    expect(mockAuthRequest.mock.calls[0]?.[0]).toBe("/api/interactions/mine");
  });

  it("narrows to a status when its chip is clicked, and back out again", async () => {
    const wrapper = await mountCard();

    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();
    // Back to page one: the offsets belonged to the unfiltered list.
    expect(queryOf(1)).toMatchObject({ page: 1, filter: "pending" });

    // The same chip is the way out.
    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();
    expect(queryOf(2)).toMatchObject({ page: 1, filter: "all" });
  });

  it("clears the filter from the reset button", async () => {
    const wrapper = await mountCard();

    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="proposal-filter-clear"]').trigger("click");
    await flushPromises();
    expect(queryOf(2)).toMatchObject({ page: 1, filter: "all" });
  });

  it("does not offer a filter that would select nothing", async () => {
    const wrapper = await mountCard();

    // `Odrzucone 0` is still worth reading, so it stays on screen - it just
    // cannot be clicked into an empty list.
    const rejected = wrapper.get('[data-testid="proposal-filter-rejected"]');
    expect(rejected.text()).toContain("0");
    await rejected.trigger("click");
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps saying the reader has proposals while a filter hides them", async () => {
    mockAuthRequest.mockResolvedValue(
      // Narrowed to a state whose page happens to be empty: the counts still
      // say three proposals exist, so the card must not claim otherwise.
      respond({ items: [], total: 0 }),
    );
    const wrapper = await mountCard();

    expect(wrapper.text()).not.toContain("Nie masz jeszcze głosów");
  });

  it("lists a vote as the person and the step of the scale", async () => {
    mockAuthRequest.mockResolvedValue(
      respond({
        items: [vote(), vote({ nodeId: "p2", name: "Jan Lis", value: -2 })],
        total: 2,
        counts: { ...emptyProposalCounts(), votes: 2 },
      }),
    );
    const wrapper = await mountCard();

    const rows = wrapper.findAll('[data-testid="my-vote"]');
    expect(rows.map((row) => verdictOf(row))).toEqual([
      "+3 Koryciarz",
      "-2 Wygląda w porządku",
    ]);
    expect(rows.map((row) => row.get("a").text())).toEqual([
      "Anna Nowak",
      "Jan Lis",
    ]);
    expect(rows[0]!.get("a").attributes("href")).toBe("/osoba/anna-nowak-p1");
    // The number in the colours the vote control gives it.
    expect(rows[0]!.get("strong").classes()).toContain("text-ink-success");
    expect(rows[1]!.get("strong").classes()).toContain("text-ink-danger");
  });

  it("gives a vote off the scale no words", async () => {
    // Cast before votes were capped at 5. „Dobre znalezisko”, the category's
    // own name, is also the name of +2.
    mockAuthRequest.mockResolvedValue(
      respond({
        items: [vote({ value: 18 })],
        total: 1,
        counts: { ...emptyProposalCounts(), votes: 1 },
      }),
    );
    const wrapper = await mountCard();

    expect(verdictOf(wrapper.get('[data-testid="my-vote"]'))).toBe("+18");
  });

  it("keeps the row of a person who is gone, without a link", async () => {
    mockAuthRequest.mockResolvedValue(
      respond({
        items: [vote({ name: null, path: null })],
        total: 1,
        counts: { ...emptyProposalCounts(), votes: 1 },
      }),
    );
    const wrapper = await mountCard();

    const row = wrapper.get('[data-testid="my-vote"]');
    expect(row.text()).toContain("Usunięty wpis");
    expect(row.find("a").exists()).toBe(false);
  });

  it("narrows to the votes from their chip, and back out again", async () => {
    mockAuthRequest.mockResolvedValue(
      respond({
        counts: { ...emptyProposalCounts(), pending: 2, approved: 1, votes: 4 },
      }),
    );
    const wrapper = await mountCard();

    const chip = wrapper.get('[data-testid="interaction-filter-votes"]');
    expect(chip.text()).toBe("Głosy 4");
    await chip.trigger("click");
    await flushPromises();
    expect(queryOf(1)).toMatchObject({ page: 1, filter: "votes" });

    await wrapper
      .get('[data-testid="interaction-filter-votes"]')
      .trigger("click");
    await flushPromises();
    expect(queryOf(2)).toMatchObject({ page: 1, filter: "all" });
  });

  it("does not offer the votes chip with no votes", async () => {
    const wrapper = await mountCard();

    const chip = wrapper.get('[data-testid="interaction-filter-votes"]');
    expect(chip.text()).toBe("Głosy 0");
    await chip.trigger("click");
    await flushPromises();
    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("says where to start when there is nothing yet", async () => {
    mockAuthRequest.mockResolvedValue(
      respond({
        items: [],
        total: 0,
        counts: { ...emptyProposalCounts(), votes: 0 },
      }),
    );
    const wrapper = await mountCard();

    expect(wrapper.text()).toContain(
      "Nie masz jeszcze głosów ani propozycji zmian.",
    );
    expect(wrapper.get('a[href="/eksploruj/nowe"]').text()).toBe("kolejce");
    // About proposals, so not said to somebody who has none.
    expect(wrapper.text()).not.toContain("Zatwierdzenie zmiany");
  });

  it("is still a list of somebody's work with votes and no proposals", async () => {
    mockAuthRequest.mockResolvedValue(
      respond({
        items: [vote()],
        total: 1,
        counts: { ...emptyProposalCounts(), votes: 1 },
      }),
    );
    const wrapper = await mountCard();

    expect(wrapper.text()).not.toContain("Nie masz jeszcze głosów");
    expect(
      wrapper.find('[data-testid="interaction-filter-votes"]').exists(),
    ).toBe(true);
  });

  it("says when the votes could not be read, above the proposals", async () => {
    mockAuthRequest.mockResolvedValue(respond({ votesFailed: true }));
    const wrapper = await mountCard();

    expect(wrapper.get('[data-testid="votes-failed"]').text()).toContain(
      "Nie udało się wczytać Twoich głosów.",
    );
    expect(wrapper.findAll('[data-testid="my-proposal"]')).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import MyRevisions from "../../../app/components/profile/MyRevisions.vue";
import { emptyProposalCounts, type Proposal } from "~~/shared/proposals";

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
  ...over,
});

const respond = (over: Record<string, unknown> = {}) => ({
  revisions: [proposal()],
  total: 3,
  counts: { ...emptyProposalCounts(), pending: 2, approved: 1 },
  truncated: false,
  ...over,
});

const mountCard = async () => {
  const wrapper = mount(MyRevisions, { global: { plugins: [vuetify], stubs } });
  await flushPromises();
  return wrapper;
};

/** The query of the nth call to the endpoint. */
const queryOf = (call: number) =>
  (mockAuthRequest.mock.calls[call]?.[1] as { query: Record<string, unknown> })
    .query;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthRequest.mockResolvedValue(respond());
});

describe("MyRevisions", () => {
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

    expect(queryOf(0)).toMatchObject({ page: 1, status: "all" });
  });

  it("narrows to a status when its chip is clicked, and back out again", async () => {
    const wrapper = await mountCard();

    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();
    // Back to page one: the offsets belonged to the unfiltered list.
    expect(queryOf(1)).toMatchObject({ page: 1, status: "pending" });

    // The same chip is the way out.
    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();
    expect(queryOf(2)).toMatchObject({ page: 1, status: "all" });
  });

  it("clears the filter from the reset button", async () => {
    const wrapper = await mountCard();

    await wrapper
      .get('[data-testid="proposal-filter-pending"]')
      .trigger("click");
    await flushPromises();

    await wrapper.get('[data-testid="proposal-filter-clear"]').trigger("click");
    await flushPromises();
    expect(queryOf(2)).toMatchObject({ page: 1, status: "all" });
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
      respond({ revisions: [], total: 0 }),
    );
    const wrapper = await mountCard();

    expect(wrapper.text()).not.toContain("Nie zgłosiłeś jeszcze żadnej zmiany");
  });
});

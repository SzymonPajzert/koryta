import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { VBtn } from "vuetify/components";
import NodeProposals from "../../../app/components/revision/NodeProposals.vue";
import { emptyProposalCounts, type Proposal } from "~~/shared/proposals";

/** The card on an entry's page that answers "did my change go through?".
 *
 * Everything here is about the failure it was written for: a contributor saw
 * no trace of what they had proposed, so they proposed it again.
 */

const { mockAuthRequest, currentUser } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  currentUser: { value: { uid: "u1" } as { uid: string } | null },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: currentUser }),
}));

const vuetify = createVuetify({ components, directives });

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
  targetId: "firma-1",
  targetCollection: "nodes",
  targetName: "Tramwaje Śląskie",
  targetType: "place",
  targetPath: "/instytucja/tramwaje-slaskie-firma-1",
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

const respond = (rows: Proposal[]) => ({
  revisions: rows,
  total: rows.length,
  counts: emptyProposalCounts(),
  truncated: false,
});

const mountCard = async (nodeId = "firma-1") => {
  const wrapper = mount(NodeProposals, {
    props: { nodeId },
    global: { plugins: [vuetify], stubs },
  });
  await flushPromises();
  return wrapper;
};

describe("RevisionNodeProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.value = { uid: "u1" };
    mockAuthRequest.mockResolvedValue(respond([proposal()]));
  });

  it("asks only for what this reader proposed for this entry", async () => {
    await mountCard();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/revisions/mine", {
      method: "GET",
      query: { limit: 20, page: 1, status: "all", nodeId: "firma-1" },
    });
  });

  it("shows the pending proposal, and where to read it", async () => {
    const wrapper = await mountCard();

    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(true);
    const preview = wrapper.find("[data-testid='node-proposal-preview-rev1']");
    expect(preview.attributes("href")).toBe(
      "/instytucja/tramwaje-slaskie-firma-1?revisionId=rev1",
    );
    expect(wrapper.text()).toContain("1 propozycja czeka na redakcję");
  });

  it("leads to the entry's full history", async () => {
    const wrapper = await mountCard();

    // Read off the prop rather than off an `href`: a bare mount has no router
    // for `v-btn` to resolve `to` against, and installing one takes the
    // Vuetify plugin chain with it.
    const history = wrapper
      .findAllComponents(VBtn)
      .find(
        (btn) => btn.attributes("data-testid") === "node-proposals-history",
      );
    expect(history?.props("to")).toBe("/admin/rewizje/firma-1");
  });

  it("says what a reviewer decided, and why they said no", async () => {
    mockAuthRequest.mockResolvedValue(
      respond([proposal({ status: "rejected", rejectReason: "Brak źródła" })]),
    );

    const wrapper = await mountCard();

    expect(wrapper.text()).toContain("Powód: Brak źródła");
    expect(wrapper.text()).toContain("Redakcja rozpatrzyła wszystko");
  });

  it("renders nothing at all when there is nothing to say", async () => {
    // Every company page mounts this, and the great majority of readers have
    // never proposed anything: an empty card on all of them would be noise.
    mockAuthRequest.mockResolvedValue(respond([]));

    const wrapper = await mountCard();

    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(false);
  });

  it("does not call an authenticated endpoint for a logged out reader", async () => {
    currentUser.value = null;

    const wrapper = await mountCard();

    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(false);
  });

  it("stays quiet when the endpoint fails", async () => {
    // The page is about the company. A failure to load the proposal machinery
    // must not become the loudest thing on it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAuthRequest.mockRejectedValue(new Error("500"));

    const wrapper = await mountCard();

    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(false);
    logged.mockRestore();
  });

  it("re-reads on request, which is what a fresh submission triggers", async () => {
    mockAuthRequest.mockResolvedValue(respond([]));
    const wrapper = await mountCard();
    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(false);

    mockAuthRequest.mockResolvedValue(respond([proposal()]));
    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await flushPromises();

    expect(wrapper.find("[data-testid='node-proposals']").exists()).toBe(true);
  });
});

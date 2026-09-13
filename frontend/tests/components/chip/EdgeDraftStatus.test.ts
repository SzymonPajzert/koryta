import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import EdgeDraftStatus from "../../../app/components/chip/EdgeDraftStatus.vue";
import { authRequest, useAuthState } from "~/composables/auth";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
  authFetch: vi.fn(),
}));

const mockAuthRequest = authRequest as unknown as ReturnType<typeof vi.fn>;

const mountChip = (
  props: { edgeId?: string; published?: boolean; publishable?: boolean },
  who: { signedIn?: boolean; isAdmin?: boolean } = {},
) => {
  (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: ref(who.signedIn === false ? null : { uid: "u" }),
    isAdmin: ref(who.isAdmin === true),
  });
  return mountSuspended(EdgeDraftStatus, { props });
};

describe("ChipEdgeDraftStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a relation nobody has published", async () => {
    const wrapper = await mountChip({ edgeId: "e1", published: false });
    expect(wrapper.text()).toContain("szkic");
  });

  it("says nothing on a relation that is live", async () => {
    const wrapper = await mountChip({ edgeId: "e1", published: true });
    expect(wrapper.text()).not.toContain("szkic");
  });

  it("stays silent for a logged out visitor", async () => {
    // They are never served an unpublished relation, so the badge could only
    // ever appear on a row they are not looking at.
    const wrapper = await mountChip(
      { edgeId: "e1", published: false },
      { signedIn: false },
    );
    expect(wrapper.text()).not.toContain("szkic");
  });

  it("offers an admin the way to publish, from the row itself", async () => {
    mockAuthRequest.mockResolvedValue({ published: true });
    const wrapper = await mountChip(
      { edgeId: "e1", published: false },
      { isAdmin: true },
    );

    await wrapper
      .find('[data-testid="edge-draft-publish-e1"]')
      .trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/edges/publish", {
      body: { edge_ids: ["e1"], published: true },
    });
    // The badge is the confirmation: it says „szkic" before the click and is
    // gone after it, whether or not the caller refetches the list.
    expect(wrapper.text()).not.toContain("szkic");
    expect(wrapper.emitted("published")).toHaveLength(1);
  });

  it("does not offer it to a contributor", async () => {
    const wrapper = await mountChip({ edgeId: "e1", published: false });
    expect(wrapper.find('[data-testid="edge-draft-publish-e1"]').exists()).toBe(
      false,
    );
  });

  it("does not offer it where one end is still a draft", async () => {
    // The rule /api/edges/publish enforces. A button here could only ever
    // produce a refusal, and the relations of a draft page are published by
    // that page's own dialog.
    const wrapper = await mountChip(
      { edgeId: "e1", published: false, publishable: false },
      { isAdmin: true },
    );
    expect(wrapper.text()).toContain("szkic");
    expect(wrapper.find('[data-testid="edge-draft-publish-e1"]').exists()).toBe(
      false,
    );
  });

  it("does not offer it where there is no relation to publish", async () => {
    // The rows drawn from a revision preview have no stored edge behind them.
    const wrapper = await mountChip({ published: false }, { isAdmin: true });
    expect(
      wrapper.find('[data-testid="edge-draft-publish-undefined"]').exists(),
    ).toBe(false);
  });

  it("keeps the badge, and says why, when the server refuses", async () => {
    mockAuthRequest.mockRejectedValue({
      data: { message: "Nie można opublikować powiązania: Jan Kowalski." },
    });
    const wrapper = await mountChip(
      { edgeId: "e1", published: false },
      { isAdmin: true },
    );

    await wrapper
      .find('[data-testid="edge-draft-publish-e1"]')
      .trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain("szkic");
    expect(wrapper.emitted("published")).toBeUndefined();
  });
});

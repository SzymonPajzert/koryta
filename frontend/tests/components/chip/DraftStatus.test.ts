import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import DraftStatus from "../../../app/components/chip/DraftStatus.vue";
import { useAuthState } from "~/composables/auth";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
  authFetch: vi.fn(),
}));

const mountChip = (
  props: { published?: boolean; nodeId?: string; nodeName?: string },
  who: { signedIn?: boolean; isAdmin?: boolean } = {},
) => {
  (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: ref(who.signedIn === false ? null : { uid: "u" }),
    isAdmin: ref(who.isAdmin === true),
  });
  return mountSuspended(DraftStatus, { props });
};

describe("ChipDraftStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a page nobody has published", async () => {
    expect((await mountChip({ published: false })).text()).toContain("szkic");
  });

  it("says nothing at all on a published page", async () => {
    // „opublikowane" on nine pages in ten is a word repeated everywhere to
    // mark the exception by its absence, which is why the table dropped its
    // „Widoczność" column for this badge.
    expect((await mountChip({ published: true })).text()).not.toContain(
      "szkic",
    );
  });

  it("reads a missing flag as a draft", async () => {
    // Every endpoint serving a page a reader can reach carries `published`, so
    // an absent one is a page that was never published.
    expect((await mountChip({})).text()).toContain("szkic");
  });

  it("stays silent for a logged out visitor", async () => {
    // They cannot load a draft page in the first place, so the badge could only
    // ever appear on a page they are not looking at.
    expect(
      (await mountChip({ published: false }, { signedIn: false })).text(),
    ).not.toContain("szkic");
  });

  it("offers an admin the way to publish, from the page itself", async () => {
    const wrapper = await mountChip(
      { published: false, nodeId: "person-1", nodeName: "Anna Nowak" },
      { isAdmin: true },
    );
    expect(wrapper.find('[data-testid="draft-status-publish"]').exists()).toBe(
      true,
    );
  });

  it("does not offer it to a contributor", async () => {
    const wrapper = await mountChip({ published: false, nodeId: "person-1" });
    expect(wrapper.find('[data-testid="draft-status-publish"]').exists()).toBe(
      false,
    );
  });

  it("does not offer it where there is no node to publish", async () => {
    // A preview of a proposed change is rendered from revision data, which
    // points at nothing yet.
    const wrapper = await mountChip({ published: false }, { isAdmin: true });
    expect(wrapper.find('[data-testid="draft-status-publish"]').exists()).toBe(
      false,
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import CommentsSection from "../../../app/components/comment/CommentsSection.vue";

vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: ref({ uid: "reader" }) }),
}));

registerEndpoint("/api/comments/list", () => []);

async function mount(props: Record<string, unknown>) {
  const section = await mountSuspended(CommentsSection, { props });
  await flushPromises();
  return section;
}

describe("CommentsSection", () => {
  beforeEach(() => clearNuxtData());

  it("says what a comment is for, next to the notes above it", async () => {
    // „Sam nawet do końca nie rozumiem jaka jest różnica pomiędzy komentarzem
    // i notatka” - from a reader who had just posted a test comment.
    const section = await mount({ nodeId: "person-1" });

    const lead = section.get("[data-testid='comments-lead']");
    expect(lead.text()).toContain("Pytania i uwagi");
    expect(lead.text()).toContain("w notatce");
  });

  it("leaves it off the leads page, which has no notes to point at", async () => {
    const section = await mount({ leadMode: true });

    expect(section.find("[data-testid='comments-lead']").exists()).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import CommentsSection from "../../../app/components/comment/CommentsSection.vue";
import type { Comment } from "../../../shared/model";

/** Who is reading: signed in, unless a test says otherwise. */
const reader = vi.hoisted(() => ({
  user: { uid: "reader" } as { uid: string } | null,
}));
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: ref(reader.user) }),
}));

/** What the list answers with, set by each test before it mounts. */
let comments: Comment[] = [];
registerEndpoint("/api/comments/list", () => comments);

function comment(id: string, fields: Partial<Comment> = {}): Comment {
  return {
    id,
    content: `Komentarz ${id}`,
    authorId: "a1",
    authorName: "Anna",
    createdAt: "2026-10-01T10:00:00Z",
    isLead: false,
    nodeId: "person-1",
    ...fields,
  };
}

async function mount(props: Record<string, unknown>) {
  const section = await mountSuspended(CommentsSection, { props });
  await flushPromises();
  return section;
}

describe("CommentsSection", () => {
  beforeEach(() => {
    clearNuxtData();
    comments = [];
    reader.user = { uid: "reader" };
  });

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

  it("is a section of the page like the ones above it, headed „Dyskusja”", async () => {
    // „Dyskusja (N)” used to be an h3 of its own among the page's h2s.
    const section = await mount({ nodeId: "person-1" });

    expect(section.get("h2").text()).toBe("Dyskusja");
    expect(section.find("h3").exists()).toBe(false);
    expect(section.get("h2").text()).not.toContain("(");
  });

  it("counts the comments beside the heading, replies included", async () => {
    comments = [
      comment("c1"),
      comment("c2"),
      comment("r1", { parentId: "c1" }),
    ];
    const section = await mount({ nodeId: "person-1" });

    expect(section.get(".sec-head__caption").text()).toBe("3 komentarze");
  });

  it("declines the count", async () => {
    const caption = async (count: number) => {
      clearNuxtData();
      comments = Array.from({ length: count }, (_, i) => comment(`c${i}`));
      const section = await mount({ nodeId: "person-1" });
      return section.get(".sec-head__caption").text();
    };

    expect(await caption(1)).toBe("1 komentarz");
    expect(await caption(5)).toBe("5 komentarzy");
    expect(await caption(22)).toBe("22 komentarze");
  });

  it("says there are none in the quiet line, and not again beside the heading", async () => {
    const section = await mount({ nodeId: "person-1" });

    expect(section.find(".sec-head__caption").exists()).toBe(false);
    const empty = section
      .findAll(".k-absent")
      .find((line) => line.text() === "Brak komentarzy.");
    expect(empty?.classes()).toEqual(["k-note", "k-absent"]);
  });

  it("tells a reader who is not signed in how to join in, in the same quiet line", async () => {
    reader.user = null;
    const section = await mount({ nodeId: "person-1" });

    const lines = section.findAll(".k-absent").map((line) => line.text());
    expect(lines).toEqual([
      "Zaloguj się, aby dodać komentarz.",
      "Brak komentarzy.",
    ]);
    expect(section.get(".k-absent a").attributes("href")).toBe("/login");
    // Nothing to add with, signed out.
    expect(
      section.findAll(".v-btn").some((b) => b.text() === "Dodaj komentarz"),
    ).toBe(false);
  });

  it("offers a signed in reader the way to add one, in the heading", async () => {
    const section = await mount({ nodeId: "person-1" });

    const add = section.get(".sec-head .v-btn");
    expect(add.text()).toBe("Dodaj komentarz");
    expect(section.text()).not.toContain("Zaloguj się, aby dodać komentarz.");
  });
});

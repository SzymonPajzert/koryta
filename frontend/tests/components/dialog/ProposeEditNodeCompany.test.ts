import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import ProposeEditNode from "../../../app/components/dialog/ProposeEditNode.vue";

/** A company's „Branże”: the sectors a person may correct, and not its owner,
 * „Skarb Państwa”, which follows Prokuratoria's list whatever the form says -
 * see `withOwnersFrom` in shared/companyCategories.ts. */

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  authRequest: mockAuthRequest,
}));

const currentUser = ref<{ uid: string } | null>({ uid: "reader" });
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => currentUser,
}));

// Vuetify's overlay observes resizes, which the test DOM cannot.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

/** PGE as the 2026-10-29 export has it, once the list has given it its
 * owner: „Energetyka” set by hand, so the categories are pinned. */
const pge = () => ({
  id: "pge",
  type: "place",
  name: "PGE Polska Grupa Energetyczna",
  krsNumber: "0000059307",
  categories: ["energetyka", "skarb-panstwa"],
  categoriesSource: "manual",
});

async function mount(entity: Record<string, unknown>) {
  return mountSuspended(ProposeEditNode, {
    props: { entity, skipRedirect: true },
    route: "/instytucja/pge-polska-grupa-energetyczna-pge",
    global: { stubs: { DialogLogin: true } },
  });
}

async function open(wrapper: Awaited<ReturnType<typeof mount>>) {
  await wrapper.find("button").trigger("click");
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The dialog is teleported to the body, so it is read from the document. */
const overlay = () =>
  document.querySelector<HTMLElement>(".v-overlay-container .v-dialog");

/** The select labelled `label`, the way a reader finds it. */
function select(label: string) {
  const input = [...(overlay()?.querySelectorAll(".v-select") ?? [])].find(
    (el) => el.querySelector("label")?.textContent.trim() === label,
  );
  if (!input) throw new Error(`no select labelled ${label}`);
  return input as HTMLElement;
}

const chips = (label: string) =>
  [...select(label).querySelectorAll(".v-chip")].map((chip) =>
    chip.textContent.trim(),
  );

async function submit() {
  const button = [
    ...(overlay()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((b) => b.textContent.trim() === "Zaproponuj");
  if (!button) throw new Error("no „Zaproponuj” button");
  button.click();
  await flushPromises();
}

/** What reached /api/revisions/create. */
const sent = () =>
  mockAuthRequest.mock.calls.find(
    ([url]) => url === "/api/revisions/create",
  )?.[1]?.body as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  currentUser.value = { uid: "reader" };
  mockAuthRequest.mockResolvedValue({
    id: "rev-1",
    node_id: "pge",
    duplicate: false,
  });
});

describe("DialogProposeEditNode on a company", () => {
  it("shows the sectors under „Branże”, without the owner", async () => {
    const wrapper = await mount(pge());
    await open(wrapper);

    expect(chips("Branże")).toEqual(["Energetyka"]);
  });

  it("sends the sectors alone, so a save cannot take the owner off", async () => {
    // `/api/revisions/create` lays the stored owner over what this sends,
    // which is what keeps „Skarb Państwa” on PGE through the edit.
    const wrapper = await mount(pge());
    await open(wrapper);

    await submit();

    expect(sent()).toMatchObject({
      node_id: "pge",
      categories: ["energetyka"],
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import ProposeEditNode from "../../../app/components/dialog/ProposeEditNode.vue";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  authRequest: mockAuthRequest,
}));

// Signed in, because a signed out reader gets the login dialog instead of this
// one - see `handleActivatorClick`.
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

/** A title as the import left it: the site's name kept on the end, where a
 * one-line field had it out of sight. */
const SCRAPED_TITLE =
  'Żona znanego polityka PiS rozwścieczyła partię. "Niestety, ale wszyscy zauważyli" | Newsweek';

const article = () => ({
  id: "a1",
  type: "article",
  name: SCRAPED_TITLE,
  sourceURL: "https://www.newsweek.pl/polska/polityka/zona-znanego-polityka",
});

async function mount(entity: Record<string, unknown>) {
  return mountSuspended(ProposeEditNode, {
    props: { entity, skipRedirect: true },
    route: "/artykul/a1",
    // The login dialog is only ever opened for a signed out reader.
    global: { stubs: { DialogLogin: true } },
  });
}

/** The dialog is teleported to the body, so it is read from the document. */
const overlay = () =>
  document.querySelector<HTMLElement>(".v-overlay-container .v-dialog");

const fieldLabels = () =>
  [...(overlay()?.querySelectorAll("label") ?? [])].map((label) =>
    label.textContent.trim(),
  );

function field(label: string) {
  const input = [...(overlay()?.querySelectorAll(".v-input") ?? [])].find(
    (el) => el.querySelector("label")?.textContent.trim() === label,
  );
  const control = input?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  if (!control) throw new Error(`no field labelled ${label}`);
  return control;
}

async function type(label: string, value: string) {
  const control = field(label);
  control.value = value;
  control.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function click(label: string) {
  const button = [
    ...(overlay()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((b) => b.textContent.trim() === label);
  if (!button) throw new Error(`no button labelled ${label}`);
  button.click();
  await flushPromises();
}

async function open(wrapper: Awaited<ReturnType<typeof mount>>) {
  await wrapper.find("button").trigger("click");
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    node_id: "a1",
    duplicate: false,
  });
});

describe("DialogProposeEditNode on an article", () => {
  it("calls the name a title, and shows the whole of it", async () => {
    const wrapper = await mount(article());
    await open(wrapper);

    expect(fieldLabels()).toContain("Tytuł");
    expect(fieldLabels()).not.toContain("Nazwa / Imię i nazwisko");
    // A box that grows with the text rather than a field one line wide, with
    // the title in it as stored, „| Newsweek” and all.
    const title = field("Tytuł");
    expect(title.tagName).toBe("TEXTAREA");
    expect(title.value).toBe(SCRAPED_TITLE);
  });

  it("sends the corrected title along with the address the article has", async () => {
    const wrapper = await mount(article());
    await open(wrapper);

    await type(
      "Tytuł",
      'Żona znanego polityka PiS rozwścieczyła partię. "Niestety, ale wszyscy zauważyli"',
    );
    await click("Zaproponuj");

    expect(sent()).toMatchObject({
      node_id: "a1",
      name: 'Żona znanego polityka PiS rozwścieczyła partię. "Niestety, ale wszyscy zauważyli"',
      sourceURL: article().sourceURL,
    });
    expect(wrapper.emitted("submitted")).toEqual([["rev-1", false]]);
  });

  it("asks for a title, not a name, when it is left empty", async () => {
    const wrapper = await mount(article());
    await open(wrapper);

    await type("Tytuł", "   ");
    await click("Zaproponuj");

    expect(overlay()?.textContent).toContain("Tytuł jest wymagany");
    expect(sent()).toBeUndefined();
  });

  it("adds no line on Enter, since a title is one line wherever it is drawn", async () => {
    const wrapper = await mount(article());
    await open(wrapper);

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    field("Tytuł").dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(true);
  });

  it("keeps a person's one-line name field as it was", async () => {
    const wrapper = await mount({
      id: "p1",
      type: "person",
      name: "Jan Kowalski",
    });
    await open(wrapper);

    expect(fieldLabels()).toContain("Nazwa / Imię i nazwisko");
    expect(field("Nazwa / Imię i nazwisko").tagName).toBe("INPUT");
  });
});

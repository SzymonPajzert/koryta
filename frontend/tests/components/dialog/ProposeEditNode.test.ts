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

const person = () => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
  content: "Radny",
});

async function mount(props: Record<string, unknown>, route = "/osoba/p1") {
  return mountSuspended(ProposeEditNode, {
    props,
    route,
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

/** How the endpoint answers: filed for review unless told otherwise. */
function answers(fields: { applied?: boolean; id?: string } = {}) {
  mockAuthRequest.mockResolvedValue({
    id: fields.id ?? "rev-1",
    node_id: "p1",
    duplicate: false,
    applied: fields.applied ?? false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  currentUser.value = { uid: "reader" };
  answers();
});

describe("DialogProposeEditNode, whether a change waits for review", () => {
  it("files a reader's correction as a proposal, and says so first", async () => {
    const wrapper = await mount({ entity: person(), skipRedirect: true });
    await open(wrapper);

    expect(overlay()?.textContent).toContain(
      "Zmiany będą musiały zostać zatwierdzone",
    );
    await type("Treść (opcjonalnie)", "Radny miasta");
    await click("Zaproponuj");

    expect(sent()).toMatchObject({
      node_id: "p1",
      name: "Jan Kowalski",
      content: "Radny miasta",
    });
    expect(sent()).not.toHaveProperty("apply");
    expect(wrapper.emitted("submitted")).toEqual([["rev-1", false, false]]);
  });

  it("puts an admin's edit live where the page offers it, and says so before they save", async () => {
    // A topic's description had to be corrected in the database by hand,
    // because no page could do it - and filed as a proposal, an admin's own
    // correction only waits for the same admin to approve it.
    answers({ applied: true, id: "rev-2" });
    const wrapper = await mount({
      entity: person(),
      canApply: true,
      skipRedirect: true,
    });

    // Named for what it does, for the tooltip and for a screen reader.
    expect(wrapper.text()).toContain("Edytuj wpis");
    await open(wrapper);

    expect(overlay()?.textContent).toContain("Zmiana wchodzi od razu");
    expect(overlay()?.textContent).not.toContain("Zaproponuj");
    await type("Treść (opcjonalnie)", "Radny miasta");
    await click("Zapisz zmianę");

    expect(sent()).toMatchObject({
      node_id: "p1",
      content: "Radny miasta",
      apply: true,
    });
    expect(wrapper.emitted("submitted")).toEqual([["rev-2", false, true]]);
  });

  it("does not send an applied edit off to preview itself", async () => {
    // `?revisionId=` renders a page as a proposal would leave it. An applied
    // edit has left it that way already, so a host that forgot `skipRedirect`
    // must not be sent to a preview of what it is showing.
    answers({ applied: true });
    const wrapper = await mount({ entity: person(), canApply: true });
    await open(wrapper);

    await type("Treść (opcjonalnie)", "Radny miasta");
    await click("Zapisz zmianę");

    expect(wrapper.vm.$route.query.revisionId).toBeUndefined();
  });

  it("proposes a new entry whatever the reader may do to one that exists", async () => {
    // A new entry is reviewed by being published, so there is nothing an
    // admin's claim could let it skip.
    const wrapper = await mount({
      createType: "topic",
      initialName: "Afera powodziowa",
      canApply: true,
      skipRedirect: true,
    });
    await open(wrapper);

    expect(overlay()?.textContent).toContain("Zaproponuj nowy temat");
    await click("Zaproponuj");

    expect(sent()).toMatchObject({ type: "topic", name: "Afera powodziowa" });
    expect(sent()).not.toHaveProperty("apply");
  });
});

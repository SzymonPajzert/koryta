import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PublicProfileSettings from "../../../app/components/profile/PublicProfileSettings.vue";
import type { OwnProfileSettings } from "~~/shared/userAdmin";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

const vuetify = createVuetify({ components, directives });

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: "" } },
  setup(props, { slots }) {
    return () => h("a", { href: String(props.to) }, slots.default?.());
  },
});

const settings = (
  over: Partial<OwnProfileSettings> = {},
): OwnProfileSettings => ({
  publicProfile: true,
  handle: "anna-nowak",
  path: "/uczestnik/anna-nowak",
  hidden: false,
  avatar: null,
  ...over,
});

const mountBlock = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(PublicProfileSettings, {
    props: { publicProfile: true, saving: false, loaded: true, ...props },
    global: { plugins: [vuetify], stubs: { NuxtLink: NuxtLinkStub } },
  });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountBlock>>;

const field = (wrapper: Wrapper) => wrapper.find("input");
const saveButton = (wrapper: Wrapper) =>
  wrapper.find("[data-testid='public-profile-save']");

const typeHandle = async (wrapper: Wrapper, value: string) => {
  await field(wrapper).setValue(value);
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthRequest.mockResolvedValue(settings());
});

describe("ProfilePublicProfileSettings", () => {
  it("says the profile is off, and asks the server nothing", async () => {
    const wrapper = await mountBlock({ publicProfile: false });

    expect(wrapper.text()).toContain("Publiczny profil jest wyłączony");
    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it("waits for the stored setting before saying anything", async () => {
    const wrapper = await mountBlock({ publicProfile: false, loaded: false });

    expect(wrapper.text()).toBe("");
    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it("shows the address of a public profile and lets it be changed", async () => {
    const wrapper = await mountBlock();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/users/profile", {
      method: "GET",
    });
    expect(wrapper.find("a").attributes("href")).toBe("/uczestnik/anna-nowak");
    expect((field(wrapper).element as HTMLInputElement).value).toBe(
      "anna-nowak",
    );
    // Nothing to save until the address differs from the one it has.
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("asks only once the switch is saved, so the handle is made then", async () => {
    // The server gives a profile its handle when it is asked while the switch
    // is on; asked before the write lands, it would still read "off".
    const wrapper = await mountBlock({ saving: true });
    expect(mockAuthRequest).not.toHaveBeenCalled();

    await wrapper.setProps({ saving: false });
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledTimes(1);
  });

  it("asks again when the switch goes off and on", async () => {
    const wrapper = await mountBlock();
    await wrapper.setProps({ publicProfile: false });
    await wrapper.setProps({ publicProfile: true });
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["too short", "ab"],
    ["with Polish letters", "łukasz"],
    ["reserved", "redakcja"],
  ])("explains why a handle %s will not do", async (_, value) => {
    const wrapper = await mountBlock();

    await typeHandle(wrapper, value);

    expect(wrapper.text()).toContain("3-30 znaków");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("saves the handle as the server will store it", async () => {
    const wrapper = await mountBlock();
    mockAuthRequest.mockResolvedValueOnce(
      settings({ handle: "ania-z-krakowa", path: "/uczestnik/ania-z-krakowa" }),
    );

    await typeHandle(wrapper, " Ania-Z-Krakowa ");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenLastCalledWith(
      "/api/users/profile/handle",
      { method: "POST", body: { handle: "ania-z-krakowa" } },
    );
    expect(wrapper.find("a").attributes("href")).toBe(
      "/uczestnik/ania-z-krakowa",
    );
    expect(wrapper.emitted("notify")?.at(-1)).toEqual([
      "Zmieniono adres profilu.",
      "success",
    ]);
  });

  it("passes on why the server refused", async () => {
    const wrapper = await mountBlock();
    mockAuthRequest.mockRejectedValueOnce(
      Object.assign(new Error("409"), {
        statusCode: 409,
        data: { message: "Ten adres profilu jest już zajęty. Wybierz inny." },
      }),
    );

    await typeHandle(wrapper, "bartek");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("notify")?.at(-1)).toEqual([
      "Ten adres profilu jest już zajęty. Wybierz inny.",
      "error",
    ]);
    // What was typed stays, to be corrected rather than retyped.
    expect((field(wrapper).element as HTMLInputElement).value).toBe("bartek");
  });

  it("says when an administrator hid the profile, and links nowhere", async () => {
    mockAuthRequest.mockResolvedValue(settings({ hidden: true, path: null }));

    const wrapper = await mountBlock();

    expect(wrapper.text()).toContain("ukrył Twój profil");
    expect(wrapper.find("a").exists()).toBe(false);
  });

  it("offers to try again when the settings could not be read", async () => {
    mockAuthRequest.mockRejectedValueOnce(new Error("offline"));

    const wrapper = await mountBlock();

    expect(wrapper.text()).toContain("Nie udało się wczytać");
    await wrapper.find("[data-testid='public-profile-retry']").trigger("click");
    await flushPromises();

    expect(wrapper.find("a").attributes("href")).toBe("/uczestnik/anna-nowak");
  });
});

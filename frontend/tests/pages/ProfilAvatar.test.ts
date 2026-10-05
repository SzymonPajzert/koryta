import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ProfilPage from "../../app/pages/profil.vue";
import { ImageUploadError } from "../../app/utils/imageUpload";

const vuetify = createVuetify({ components, directives });

const { mockAuthRequest, mockPrepareImage, mockReload, signedIn } = vi.hoisted(
  () => ({
    mockAuthRequest: vi.fn(),
    mockPrepareImage: vi.fn(),
    mockReload: vi.fn(),
    /** What `useAuthState` hands the page, made afresh for each test. */
    signedIn: {} as {
      /** The account as the page holds it. */
      account: Record<string, unknown>;
      /** `users/{uid}` as the page's listener sees it. */
      config: Record<string, unknown> | null;
    },
  }),
);

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: ref(signedIn.account),
    userConfig: { data: ref(signedIn.config) },
    logout: vi.fn(),
  }),
}));

vi.mock("~/utils/imageUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/imageUpload")>()),
  prepareImage: mockPrepareImage,
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  reload: mockReload,
  updateProfile: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  getFirestore: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(),
}));

vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
}));

/** Renders what the page tells a snackbar, in place: the real one is an
 * overlay teleported out of the wrapper and closed on a timer. */
const SnackbarStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-snackbar": "" }, slots.default?.())
        : null;
  },
});

const mounted: { unmount: () => void }[] = [];

const mountPage = async () => {
  const wrapper = await mountSuspended(ProfilPage, {
    global: {
      plugins: [vuetify],
      stubs: { VSnackbar: SnackbarStub, ProfileMyRevisions: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const button = (wrapper: Wrapper, label: string) =>
  wrapper.findAll("button").find((b) => b.text().includes(label));

/** Picks `file` in the hidden input, as the camera button's dialog would. */
const pick = async (wrapper: Wrapper, file: File) => {
  const input = wrapper.get('[data-testid="avatar-input"]');
  Object.defineProperty(input.element, "files", {
    value: [file],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
};

const photo = new File(["x"], "ja.jpg", { type: "image/jpeg" });
const said = (wrapper: Wrapper) => wrapper.find("[data-snackbar]").text();

describe("/profil: the profile picture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn.account = {
      uid: "u1",
      displayName: "Jan Testowy",
      email: "jan@example.com",
      emailVerified: true,
      photoURL: null,
      getIdToken: vi.fn(async () => "token"),
    };
    signedIn.config = { publicProfile: false };
    mockPrepareImage.mockResolvedValue({
      dataUrl: "data:image/webp;base64,AAAA",
      width: 512,
      height: 512,
      bytes: 3,
    });
    mockAuthRequest.mockResolvedValue({});
    mockReload.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it("puts a camera on the avatar that opens the file picker", async () => {
    const wrapper = await mountPage();
    const input = wrapper.get('[data-testid="avatar-input"]');
    const click = vi.spyOn(input.element as HTMLInputElement, "click");

    await wrapper
      .get('button[aria-label="Zmień zdjęcie profilowe"]')
      .trigger("click");

    expect(click).toHaveBeenCalled();
    expect(input.attributes("accept")).toBe("image/*");
  });

  it("sends the picked picture prepared as an avatar, then reloads the account", async () => {
    const wrapper = await mountPage();

    await pick(wrapper, photo);

    expect(mockPrepareImage).toHaveBeenCalledWith(photo, "avatar");
    expect(mockAuthRequest).toHaveBeenCalledWith("/api/users/avatar", {
      method: "POST",
      body: { image: "data:image/webp;base64,AAAA" },
    });
    // A confirmed account goes as it is, with the token it has.
    expect(signedIn.account.getIdToken).not.toHaveBeenCalledWith(true);
    // The cached account still has the old picture otherwise.
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockReload.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockAuthRequest.mock.invocationCallOrder[0]!,
    );
    expect(said(wrapper)).toBe("Zapisano zdjęcie profilowe.");
  });

  it("says why a picture could not be prepared, and sends nothing", async () => {
    mockPrepareImage.mockRejectedValue(
      new ImageUploadError("Ten obraz jest za duży, nawet po zmniejszeniu."),
    );
    const wrapper = await mountPage();

    await pick(wrapper, photo);

    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(said(wrapper)).toBe(
      "Ten obraz jest za duży, nawet po zmniejszeniu.",
    );
  });

  it("passes on the server's refusal of an unconfirmed address", async () => {
    signedIn.account.emailVerified = false;
    mockAuthRequest.mockRejectedValue(
      Object.assign(new Error("403"), {
        statusCode: 403,
        data: {
          message: "Potwierdź adres e-mail, zanim dodasz zdjęcie profilowe.",
        },
      }),
    );
    const wrapper = await mountPage();

    await pick(wrapper, photo);

    // Asked Auth again with a fresh token, and it still is not: what the
    // server says is what the user is told.
    expect(signedIn.account.getIdToken).toHaveBeenCalledWith(true);
    expect(said(wrapper)).toBe(
      "Potwierdź adres e-mail, zanim dodasz zdjęcie profilowe.",
    );
  });

  // A 400's message is the body parser's report on a request the page built
  // itself, which says nothing the user can act on.
  it("does not pass on a parser's report", async () => {
    mockAuthRequest.mockRejectedValue(
      Object.assign(new Error("400"), {
        statusCode: 400,
        data: { message: '[{"code":"custom","path":["image"]}]' },
      }),
    );
    const wrapper = await mountPage();

    await pick(wrapper, photo);

    expect(said(wrapper)).toBe(
      "Nie udało się zapisać zdjęcia. Spróbuj ponownie.",
    );
  });

  it("takes a fresh token for an address confirmed since the page loaded", async () => {
    signedIn.account.emailVerified = false;
    mockReload.mockImplementationOnce(async (user: Record<string, unknown>) => {
      user.emailVerified = true;
    });
    const wrapper = await mountPage();

    await pick(wrapper, photo);

    // Asked Auth, then took a token that says so, then sent the picture.
    const refreshed = vi.mocked(
      signedIn.account.getIdToken as (force?: boolean) => Promise<string>,
    );
    expect(refreshed).toHaveBeenCalledWith(true);
    const [asked, sent] = [
      mockReload.mock.invocationCallOrder[0]!,
      mockAuthRequest.mock.invocationCallOrder[0]!,
    ];
    expect(asked).toBeLessThan(refreshed.mock.invocationCallOrder[0]!);
    expect(refreshed.mock.invocationCallOrder[0]).toBeLessThan(sent);
    expect(said(wrapper)).toBe("Zapisano zdjęcie profilowe.");
  });

  it.each([
    ["no picture", null, null],
    ["Google's picture", "https://lh3.googleusercontent.com/a/x", null],
    [
      "a url the users document was pointed at by hand",
      null,
      "https://example.com/x.gif",
    ],
  ])("offers no removal for %s", async (_, authPhoto, mirrored) => {
    signedIn.account.photoURL = authPhoto;
    if (mirrored) signedIn.config = { photoURL: mirrored };
    const wrapper = await mountPage();

    expect(button(wrapper, "Usuń zdjęcie profilowe")).toBeUndefined();
  });

  it("removes a picture we store, then reloads the account", async () => {
    signedIn.config = { photoURL: "https://koryta.pl/api/images/abc123" };
    const wrapper = await mountPage();

    await button(wrapper, "Usuń zdjęcie profilowe")!.trigger("click");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/users/avatar", {
      method: "DELETE",
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(said(wrapper)).toBe("Usunięto zdjęcie profilowe.");
  });

  it("says when the removal failed", async () => {
    signedIn.account.photoURL = "http://localhost:3000/api/images/abc123";
    mockAuthRequest.mockRejectedValue(new Error("network"));
    const wrapper = await mountPage();

    await button(wrapper, "Usuń zdjęcie profilowe")!.trigger("click");
    await flushPromises();

    expect(mockReload).not.toHaveBeenCalled();
    expect(said(wrapper)).toBe(
      "Nie udało się usunąć zdjęcia. Spróbuj ponownie.",
    );
  });
});

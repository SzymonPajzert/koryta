import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import FeedbackDialog from "../../app/components/feedback/Dialog.vue";
import {
  useAuthState,
  authRequest,
  anonymousRequest,
} from "~/composables/auth";
import {
  prepareScreenshot,
  type PreparedScreenshot,
} from "~/utils/screenshotImage";

// The two transports the dialog picks between. Which one carries the report is
// the whole subject of this file: `authRequest` attaches an ID token,
// `anonymousRequest` has nothing to attach.
vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref(null) })),
  authRequest: vi.fn(() => Promise.resolve({ id: "fb-1" })),
  anonymousRequest: vi.fn(() => Promise.resolve({ id: "fb-1" })),
}));

// A canvas draws nothing in the test DOM; what the dialog does with the result
// is the subject here, not the drawing.
vi.mock("~/utils/screenshotImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/screenshotImage")>()),
  prepareScreenshot: vi.fn(async (file: File) => ({
    dataUrl: `data:image/webp;base64,${btoa(file.name)}`,
    width: 10,
    height: 10,
    bytes: 4,
  })),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

// Vuetify's overlay measures the viewport and observes resizes; neither exists
// in the test DOM.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

global.visualViewport = {
  width: 1000,
  height: 1000,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as never;

const signedInAs = (email: string | null) =>
  (useAuthState as any).mockReturnValue({
    user: ref({ uid: "user-a", email }),
  });

const openDialog = async () => {
  const wrapper = await mountSuspended(FeedbackDialog, {
    props: { modelValue: false },
  });
  // The dialog snapshots its context and prefills on open, not on mount.
  await wrapper.setProps({ modelValue: true });
  await new Promise((r) => setTimeout(r, 0));
  return wrapper;
};

const contactInput = () =>
  document.querySelector<HTMLInputElement>(
    '.v-overlay-container input[type="text"]:not([tabindex="-1"])',
  );

const clickButton = async (label: string) => {
  const button = [
    ...document.querySelectorAll<HTMLElement>(".v-overlay-container button"),
  ].find((b) => b.textContent.includes(label));
  button?.click();
  await new Promise((r) => setTimeout(r, 0));
};

describe("FeedbackDialog attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("prefills a signed-in reporter's address", async () => {
    signedInAs("jan@example.com");
    await openDialog();

    expect(contactInput()?.value).toBe("jan@example.com");
  });

  it("leaves the field empty for a signed-out visitor", async () => {
    (useAuthState as any).mockReturnValue({ user: ref(null) });
    await openDialog();

    expect(contactInput()?.value).toBe("");
  });

  it("signs the report when the address is left in", async () => {
    signedInAs("jan@example.com");
    const wrapper = await openDialog();

    const textarea = document.querySelector("textarea:not([aria-hidden])");
    (textarea as HTMLTextAreaElement).value = "Coś nie gra";
    textarea?.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));

    await clickButton("Wyślij");

    // authRequest attaches the ID token, which is what the server attributes.
    expect(authRequest).toHaveBeenCalled();
    expect(anonymousRequest).not.toHaveBeenCalled();
    expect((authRequest as any).mock.calls[0][1].body.contact).toBe(
      "jan@example.com",
    );
    wrapper.unmount();
  });

  it("sends without a token once the address is cleared", async () => {
    signedInAs("jan@example.com");
    const wrapper = await openDialog();

    const input = contactInput()!;
    input.value = "";
    input.dispatchEvent(new Event("input"));

    const textarea = document.querySelector("textarea:not([aria-hidden])");
    (textarea as HTMLTextAreaElement).value = "Coś nie gra";
    textarea?.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));

    await clickButton("Wyślij");

    // The whole point: no token goes out, so the server cannot attribute the
    // report even to itself. Anonymity is a property of the request.
    expect(anonymousRequest).toHaveBeenCalled();
    expect(authRequest).not.toHaveBeenCalled();
    expect(
      (anonymousRequest as any).mock.calls[0][1].body.contact,
    ).toBeUndefined();
    wrapper.unmount();
  });
});

const typeMessage = async (text: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "textarea:not([aria-hidden])",
  )!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input"));
  await new Promise((r) => setTimeout(r, 0));
  return textarea;
};

const image = (name: string) => new File(["x"], name, { type: "image/png" });

/** A paste event carrying `types` and `files`, as a browser builds one. */
const paste = (target: Element, types: string[], files: File[]) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { types, files, items: [] },
  });
  target.dispatchEvent(event);
  return event;
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("FeedbackDialog screenshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    vi.mocked(useAuthState).mockReturnValue({
      user: ref(null),
    } as unknown as ReturnType<typeof useAuthState>);
  });

  it("sends a picked image with the report", async () => {
    const wrapper = await openDialog();
    await typeMessage("Wykres jest pusty");

    const input = document.querySelector<HTMLInputElement>(
      "[data-screenshot-input]",
    )!;
    Object.defineProperty(input, "files", { value: [image("wykres.png")] });
    input.dispatchEvent(new Event("change"));
    await settle();

    expect(prepareScreenshot).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-screenshot-preview]")).toHaveLength(
      1,
    );

    await clickButton("Wyślij");

    const [, request] = vi.mocked(anonymousRequest).mock.calls[0]!;
    expect((request?.body as { screenshots?: string[] }).screenshots).toEqual([
      `data:image/webp;base64,${btoa("wykres.png")}`,
    ]);
    wrapper.unmount();
  });

  it("takes a screenshot pasted into the message", async () => {
    const wrapper = await openDialog();
    const textarea = await typeMessage("Tu się rozjeżdża");

    const event = paste(textarea, ["Files"], [image("image.png")]);
    await settle();

    // Taken over, so the browser does not also try to paste it as text.
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelectorAll("[data-screenshot-preview]")).toHaveLength(
      1,
    );
    wrapper.unmount();
  });

  // A spreadsheet or a document puts a picture of the copied cells on the
  // clipboard beside their text; pasting them is pasting text.
  it("leaves a paste that carries text alone", async () => {
    const wrapper = await openDialog();
    const textarea = await typeMessage("Dane z tabeli:");

    const event = paste(
      textarea,
      ["text/plain", "text/html", "Files"],
      [image("image.png")],
    );
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(prepareScreenshot).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("waits for an image being prepared before it can send", async () => {
    let finish: (value: PreparedScreenshot) => void = () => {};
    vi.mocked(prepareScreenshot).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const wrapper = await openDialog();
    const textarea = await typeMessage("Coś nie gra");

    paste(textarea, ["Files"], [image("image.png")]);
    await settle();

    const send = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".v-overlay-container button",
        ),
      ].find((b) => b.textContent.includes("Wyślij"))!;
    expect(send().disabled).toBe(true);

    finish({
      dataUrl: "data:image/webp;base64,eA==",
      width: 1,
      height: 1,
      bytes: 1,
    });
    await settle();
    expect(send().disabled).toBe(false);
    wrapper.unmount();
  });

  it("says so when the images were not kept", async () => {
    vi.mocked(anonymousRequest).mockResolvedValueOnce({
      id: "fb-1",
      screenshotsDropped: 1,
    });
    const wrapper = await openDialog();
    const textarea = await typeMessage("Coś nie gra");
    paste(textarea, ["Files"], [image("image.png")]);
    await settle();

    await clickButton("Wyślij");
    await settle();

    expect(document.body.textContent).toContain(
      "Zrzutów ekranu nie zapisaliśmy",
    );
    wrapper.unmount();
  });
});

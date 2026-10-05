import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { h, ref } from "vue";
import RequestButton from "../../../app/components/access/RequestButton.vue";
import { authRequest, useAuthState } from "~/composables/auth";
import type { OwnAccessRequest } from "~~/shared/userAdmin";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
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

const URL = "/api/users/access-request";

const nothingYet: OwnAccessRequest = {
  request: null,
  canRequest: true,
  retryAfter: null,
  hasAccess: false,
};

/** What `GET` answers and what `POST` does, per test. */
let current: OwnAccessRequest;
let postResult: () => Promise<OwnAccessRequest>;

const signedIn = (fields: { emailVerified?: boolean } = {}) =>
  vi.mocked(useAuthState).mockReturnValue({
    user: ref({ uid: "user-1", emailVerified: true, ...fields }),
  } as never);

const signedOut = () =>
  vi.mocked(useAuthState).mockReturnValue({ user: ref(null) } as never);

const mount = async (
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
) => {
  const wrapper = await mountSuspended(RequestButton, {
    props: { source: "rozszerzenie", ...props },
    slots: slots as never,
  });
  await flushPromises();
  return wrapper;
};

const overlay = () =>
  document.querySelector<HTMLElement>(".v-overlay-container")?.textContent ??
  "";

const button = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".v-overlay-container button",
    ),
  ].find((b) => b.textContent.includes(label));

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
};

const type = async (text: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    ".v-overlay-container textarea:not([aria-hidden])",
  )!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input"));
  await settle();
};

describe("AccessRequestButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    current = nothingYet;
    postResult = async () => ({
      request: {
        status: "open",
        createdAt: "2026-10-05T10:00:00.000Z",
        source: "rozszerzenie",
      },
      canRequest: false,
      retryAfter: null,
      hasAccess: false,
    });
    vi.mocked(authRequest).mockImplementation((async (
      _url: string,
      options: { method?: string },
    ) => (options.method === "GET" ? current : postResult())) as never);
    signedIn();
  });

  describe("signed out", () => {
    beforeEach(signedOut);

    it("asks to sign in first, and asks the server nothing", async () => {
      const wrapper = await mount();

      expect(wrapper.text()).toContain("Zaloguj się i poproś o dostęp");
      expect(authRequest).not.toHaveBeenCalled();
    });

    it("opens the login dialog, not the request form", async () => {
      const wrapper = await mount();

      await wrapper.get("button").trigger("click");
      await settle();

      expect(overlay()).toContain("Nie masz konta? Zarejestruj się");
      expect(overlay()).not.toContain("Dlaczego chcesz dostęp?");
    });
  });

  describe("the form", () => {
    it("reads the caller's own request when it mounts", async () => {
      await mount();

      expect(authRequest).toHaveBeenCalledWith(URL, { method: "GET" });
    });

    it("waits for ten characters before it lets the request go", async () => {
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      expect(overlay()).toContain("Dlaczego chcesz dostęp?");
      expect(button("Wyślij prośbę")?.disabled).toBe(true);

      // Nine, and padded: the server trims before it counts, and so does this.
      await type("   za krótko   ");
      expect(button("Wyślij prośbę")?.disabled).toBe(true);
      expect(overlay()).toContain("15 / 1000");

      await type("Zbieram artykuły o spółkach z mojego powiatu.");
      expect(button("Wyślij prośbę")?.disabled).toBe(false);
    });

    it("refuses a reason over a thousand characters before the server does", async () => {
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      await type("a".repeat(1001));

      expect(button("Wyślij prośbę")?.disabled).toBe(true);
      expect(overlay()).toContain("Najwyżej 1000 znaków");
    });

    it("sends the trimmed reason and the page it came from", async () => {
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      await type("  Zbieram artykuły o spółkach z mojego powiatu.  ");
      button("Wyślij prośbę")!.click();
      await settle();

      expect(authRequest).toHaveBeenCalledWith(URL, {
        method: "POST",
        body: {
          reason: "Zbieram artykuły o spółkach z mojego powiatu.",
          source: "rozszerzenie",
        },
      });
      // The answer is the new state, so the button turns into the line that
      // says the request went, without a second read.
      expect(
        vi
          .mocked(authRequest)
          .mock.calls.filter(
            ([, o]) => (o as { method: string }).method === "GET",
          ),
      ).toHaveLength(1);
      expect(wrapper.text()).toContain("Prośba wysłana 5 października 2026");
    });

    it("says why the server refused, and reads the request again", async () => {
      postResult = async () => {
        current = {
          request: {
            status: "open",
            createdAt: "2026-10-04T08:00:00.000Z",
            source: "pomoc",
          },
          canRequest: false,
          retryAfter: null,
          hasAccess: false,
        };
        throw Object.assign(new Error("409"), {
          data: {
            message: "Twoja prośba o dostęp już czeka na administratorów.",
          },
        });
      };
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      await type("Zbieram artykuły o spółkach z mojego powiatu.");
      button("Wyślij prośbę")!.click();
      await settle();

      expect(overlay()).toContain(
        "Twoja prośba o dostęp już czeka na administratorów.",
      );
      // Sent from another tab: the page's picture was stale, and now it is not.
      expect(wrapper.text()).toContain("Prośba wysłana 4 października 2026");
    });

    it("warns that an unconfirmed address will hold the grant up", async () => {
      signedIn({ emailVerified: false });
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      expect(overlay()).toContain("nie jest jeszcze potwierdzony");
    });

    it("says who will read the request", async () => {
      const wrapper = await mount();
      await wrapper.get("button").trigger("click");
      await settle();

      expect(overlay()).toContain("zobaczą administratorzy");
    });
  });

  describe("instead of the form", () => {
    it("says when a waiting request went, in Warsaw's calendar", async () => {
      // 00:30 on 5 October in Warsaw, still the 4th in UTC.
      current = {
        request: {
          status: "open",
          createdAt: "2026-10-04T22:30:00.000Z",
          source: "pomoc",
        },
        canRequest: false,
        retryAfter: null,
        hasAccess: false,
      };
      const wrapper = await mount();

      expect(wrapper.text()).toContain(
        "Prośba wysłana 5 października 2026 - administratorzy odpowiedzą na koncie albo mailem.",
      );
      expect(wrapper.find("button").exists()).toBe(false);
    });

    it("gives the first whole day a dismissed request may be renewed", async () => {
      // Renewable at 17:04 on the 12th: on the morning of the 12th the form is
      // still closed, so the day it can honestly promise is the 13th.
      current = {
        request: {
          status: "dismissed",
          createdAt: "2026-10-01T08:00:00.000Z",
          source: "pomoc",
        },
        canRequest: false,
        retryAfter: "2026-10-12T15:04:00.000Z",
        hasAccess: false,
      };
      const wrapper = await mount();

      expect(wrapper.text()).toContain(
        "możesz poprosić ponownie od 13 października 2026.",
      );
      expect(wrapper.find("button").exists()).toBe(false);
    });

    it("offers the form again once a dismissed request may be renewed", async () => {
      current = {
        request: {
          status: "dismissed",
          createdAt: "2026-09-01T08:00:00.000Z",
          source: "pomoc",
        },
        canRequest: true,
        retryAfter: null,
        hasAccess: false,
      };
      const wrapper = await mount();

      expect(wrapper.get("button").text()).toContain("Poproś o dostęp");
    });

    it("says a nomination is on its way", async () => {
      current = {
        request: {
          status: "nominated",
          createdAt: "2026-10-01T08:00:00.000Z",
          source: "pomoc",
        },
        canRequest: false,
        retryAfter: "2026-10-09T08:00:00.000Z",
        hasAccess: false,
      };
      const wrapper = await mount();

      expect(wrapper.text()).toContain("Zgłosiliśmy Cię do zespołu");
      expect(wrapper.text()).not.toContain("możesz poprosić ponownie");
    });

    it("tells somebody who already has the tools, and says so to the page", async () => {
      current = { ...nothingYet, canRequest: false, hasAccess: true };
      const wrapper = await mount();

      expect(wrapper.text()).toContain("Masz już dostęp do narzędzi zespołu.");
      expect(wrapper.find("button").exists()).toBe(false);
      // /rozszerzenie listens, to fetch a token that carries the claim.
      expect(wrapper.emitted("hasAccess")).toHaveLength(1);
    });
  });

  it("lets a page draw its own activator", async () => {
    current = {
      request: {
        status: "open",
        createdAt: "2026-10-05T10:00:00.000Z",
        source: "pomoc",
      },
      canRequest: false,
      retryAfter: null,
      hasAccess: false,
    };
    const wrapper = await mount(
      { source: "pomoc" },
      {
        activator: (slot: { open: () => void; summary: string | null }) =>
          h(
            "a",
            { class: "custom", onClick: slot.open },
            slot.summary ?? "domyślny opis",
          ),
      },
    );

    expect(wrapper.get(".custom").text()).toContain("Prośba wysłana");

    await wrapper.get(".custom").trigger("click");
    await settle();

    // The dialog says the same thing rather than offering a form the server
    // would refuse.
    expect(overlay()).toContain("Prośba wysłana 5 października 2026");
    expect(button("Wyślij prośbę")).toBeUndefined();
  });
});

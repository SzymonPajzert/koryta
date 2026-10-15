import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { createSSRApp, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { useNuxtApp } from "#app";
import EntityDetailsCard from "../../app/components/EntityDetailsCard.vue";
import { useAuthState } from "~/composables/auth";
import type { Person } from "../../shared/model";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref({ uid: "test-user" }),
    isAdmin: ref(false),
  })),
  authFetch: vi.fn(),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const person: Person = {
  id: "jan",
  type: "person",
  name: "Jan Kowalski",
} as Person;

/** The admin controls sit behind `d-none d-md-flex`, so a query on the text is
 * what tells them apart - the class is a media query, not a mount condition. */
const buttonLabels = (wrapper: {
  findAll: (s: string) => { text(): string }[];
}) => wrapper.findAll(".v-btn").map((b) => b.text());

const mountCard = (isAdmin: boolean, extraLocations?: string[]) => {
  (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: ref({ uid: "test-user" }),
    isAdmin: ref(isAdmin),
  });
  return mountSuspended(EntityDetailsCard, {
    props: { entity: person, type: "person", extraLocations },
  });
};

/** The card as the server renders it, for a reader who is not signed in.
 * `mountSuspended` mounts in the browser, where a fold decided after mount
 * would look the same; this is the html the page arrives with. The app is a
 * fresh one, handed the test app's plugins (Vuetify above all) through its
 * context. */
async function renderOnServer(entity: Person): Promise<string> {
  const auth = useAuthState as unknown as ReturnType<typeof vi.fn>;
  auth.mockReturnValue({ user: ref(null), isAdmin: ref(false) });
  try {
    const nuxtApp = useNuxtApp();
    const app = createSSRApp({
      render: () => h(EntityDetailsCard, { entity, type: "person" }),
    });
    const context = nuxtApp.vueApp._context;
    app._context.provides = Object.create(context.provides);
    Object.assign(app._context.components, context.components);
    Object.assign(app._context.directives, context.directives);
    app.config.globalProperties = context.config.globalProperties;
    return await renderToString(app);
  } finally {
    auth.mockReturnValue({
      user: ref({ uid: "test-user" }),
      isAdmin: ref(false),
    });
  }
}

/** The card's style block. No stylesheet is applied in the test DOM, so a
 * rule scoped to a media query is read from the file. `import.meta.url` is
 * not a file url under the Nuxt test environment, hence cwd. */
const RELATIVE = "app/components/EntityDetailsCard.vue";
const style = (() => {
  const source = readFileSync(
    existsSync(resolve(process.cwd(), RELATIVE))
      ? resolve(process.cwd(), RELATIVE)
      : resolve(process.cwd(), "frontend", RELATIVE),
    "utf8",
  );
  return source.slice(source.indexOf("<style"));
})();

/** The body of the `@media` block for `query`, braces matched. */
function mediaBlock(query: string): string {
  const head = `@media ${query} {`;
  const start = style.indexOf(head);
  if (start < 0) return "";
  let depth = 1;
  let at = start + head.length;
  while (depth > 0 && at < style.length) {
    if (style[at] === "{") depth++;
    if (style[at] === "}") depth--;
    at++;
  }
  return style.slice(start + head.length, at - 1);
}

describe("EntityDetailsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers an admin the explore shortcut next to the revisions one", async () => {
    const wrapper = await mountCard(true);
    const labels = buttonLabels(wrapper);
    expect(labels).toContain("Eksploruj");
    expect(labels).toContain("Rewizje");
  });

  it("hides both from a reader who is not an admin", async () => {
    const wrapper = await mountCard(false);
    const labels = buttonLabels(wrapper);
    expect(labels).not.toContain("Eksploruj");
    expect(labels).not.toContain("Rewizje");
  });

  it("opens the registers and a query per place the page knows about", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    // The button is a menu now, so the tabs are one item inside it rather than
    // what the button itself does.
    const wrapper = await mountCard(true, ["Kraków"]);
    const explore = wrapper
      .findAll(".v-btn")
      .find((b) => b.text() === "Eksploruj");
    await explore!.trigger("click");
    await nextTick();
    const all = document.querySelector<HTMLElement>(
      '[data-testid="person-search-all"]',
    );
    expect(all).not.toBeNull();
    all!.click();
    await nextTick();

    const opened = open.mock.calls.map((call) => decodeURIComponent(call[0]));
    expect(opened.some((url) => url.startsWith("https://rejestr.io/"))).toBe(
      true,
    );
    expect(opened.some((url) => url.includes("wikipedia.org"))).toBe(true);
    expect(opened).toContain(
      "https://www.google.com/search?q=Jan Kowalski PKW",
    );
    // The election town the entity itself does not carry - only the page's
    // edges do, and it reaches the button as `extraLocations`.
    expect(opened).toContain(
      "https://www.google.com/search?q=Jan Kowalski Kraków",
    );

    vi.unstubAllGlobals();
  });

  it("lets a long name send the party chips to the next line rather than squeeze them", async () => {
    // jsdom lays nothing out, so this pins the two things the row needs: it
    // may wrap, and `v-card-title`'s `white-space: nowrap` is lifted. With the
    // row on one line a long name kept its full width and the chip - the only
    // item whose `overflow: hidden` lets it shrink - took all the squeeze: on a
    // 393px phone „Wioletta Paprocka-Ślusarska” left her „PO” 13px of its 40.
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: {
          ...person,
          name: "Wioletta Paprocka-Ślusarska",
          parties: ["PO"],
        } as Person,
        type: "person",
      },
    });
    const title = wrapper.get(".v-card-title");
    expect(title.find(".chip").text()).toBe("PO");
    expect(title.classes()).toContain("flex-wrap");
    expect(title.classes()).toContain("text-wrap");
  });

  it("lets „Pokaż więcej” go once the bio is open, and hands focus to the bio", async () => {
    // jsdom lays nothing out, so the four-line clamp and the phone-only media
    // query are not seen here: this pins what the button does, not where.
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, content: "Długi opis. ".repeat(30) } as Person,
        type: "person",
      },
      attachTo: document.body,
    });
    const bio = wrapper.get('[data-testid="person-bio"]');
    const more = wrapper.get('[data-testid="person-bio-more"]');
    expect(bio.classes()).toContain("person-bio--folded");
    expect(more.text()).toBe("Pokaż więcej");
    expect(more.attributes("aria-controls")).toBe(bio.attributes("id"));
    expect(more.find(".v-btn__append .v-icon").exists()).toBe(true);

    await more.trigger("click");
    await flushPromises();

    expect(bio.classes()).not.toContain("person-bio--folded");
    expect(wrapper.find('[data-testid="person-bio-more"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Pokaż mniej");
    expect(document.activeElement).toBe(bio.element);
    wrapper.unmount();
  });

  it("shows a short bio whole, with no button", async () => {
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, content: "Krótki opis." } as Person,
        type: "person",
      },
    });
    expect(wrapper.get('[data-testid="person-bio"]').classes()).not.toContain(
      "person-bio--folded",
    );
    expect(wrapper.find('[data-testid="person-bio-more"]').exists()).toBe(
      false,
    );
  });

  it("folds a bio from 214 characters, and one shorter stays whole", async () => {
    // BIO_FOLD_MIN_LENGTH, measured on the published bios: below it no bio
    // takes six lines on a 375px phone, so a fold would hide at most one.
    const at = async (length: number) => {
      const wrapper = await mountSuspended(EntityDetailsCard, {
        props: {
          entity: { ...person, content: "x".repeat(length) } as Person,
          type: "person",
        },
      });
      return {
        folded: wrapper
          .get('[data-testid="person-bio"]')
          .classes()
          .includes("person-bio--folded"),
        button: wrapper.find('[data-testid="person-bio-more"]').exists(),
      };
    };

    expect(await at(213)).toEqual({ folded: false, button: false });
    expect(await at(214)).toEqual({ folded: true, button: true });
  });

  it("puts the fold and „Pokaż więcej” in the server's html", async () => {
    // Decided by length, not measured: the page arrives folded, with its
    // button, so nothing moves when it hydrates.
    const html = await renderOnServer({
      ...person,
      content: "Długi opis. ".repeat(30),
    } as Person);
    const page = new DOMParser().parseFromString(html, "text/html");
    const bio = page.querySelector('[data-testid="person-bio"]');
    const more = page.querySelector('[data-testid="person-bio-more"]');

    expect(bio?.classList.contains("person-bio--folded")).toBe(true);
    expect(bio?.getAttribute("tabindex")).toBe("-1");
    expect(more?.textContent.trim()).toBe("Pokaż więcej");
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    expect(bio?.id).toBeTruthy();
    expect(more?.getAttribute("aria-controls")).toBe(bio?.id);
  });

  it("sends a short bio from the server whole, with no button and out of the tab order", async () => {
    const html = await renderOnServer({
      ...person,
      content: "Krótki opis.",
    } as Person);
    const page = new DOMParser().parseFromString(html, "text/html");
    const bio = page.querySelector('[data-testid="person-bio"]');

    expect(bio?.classList.contains("person-bio--folded")).toBe(false);
    expect(bio?.hasAttribute("tabindex")).toBe(false);
    expect(page.querySelector('[data-testid="person-bio-more"]')).toBeNull();
  });

  it("folds on phones only: the clamp and the button stop at the same width", () => {
    // jsdom applies no stylesheet, so the rule is read from the file. Up to
    // 440px - the widest phone - the bio is clamped to four lines; from 441
    // the button is hidden and the bio, never clamped there, shows whole.
    const phones = mediaBlock("(max-width: 440.98px)");
    const wider = mediaBlock("(min-width: 441px)");

    expect(phones).toMatch(
      /\.person-bio--folded\s*\{[^}]*-webkit-line-clamp:\s*4;[^}]*overflow:\s*hidden;/,
    );
    expect(wider).toMatch(/\.person-bio__more\s*\{\s*display:\s*none;\s*\}/);
    // Nowhere else: a clamp outside the phones' block would fold a bio on a
    // screen with no button to open it.
    expect(style.replace(phones, "")).not.toContain("person-bio--folded");
  });

  it("marks an unpublished page as a draft, and says nothing on a live one", async () => {
    const draft = await mountCard(false);
    expect(draft.text()).toContain("szkic");

    const live = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, published: true } as Person,
        type: "person",
      },
    });
    expect(live.text()).not.toContain("szkic");
  });
});

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

/** The buttons' labels, which is what tells the admin's tools apart: the row
 * is the same markup on every screen, and a phone folds the tools to squares
 * with CSS rather than leaving them out. */
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
    // jsdom lays nothing out, so this pins what the row needs: the name and
    // its chips in one row that may wrap. On one line a long name kept its
    // full width and the chip - the only item whose `overflow: hidden` lets it
    // shrink - took all the squeeze: on a 393px phone „Wioletta
    // Paprocka-Ślusarska” left her „PO” 13px of its 40.
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
    const head = wrapper.get(".entity-head");
    expect(head.get("h1").text()).toBe("Wioletta Paprocka-Ślusarska");
    expect(head.find(".chip").text()).toBe("PO");
    expect(head.classes()).toEqual(
      expect.arrayContaining(["d-flex", "flex-wrap", "align-center"]),
    );
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

  describe("the header", () => {
    /** The person with whatever the test gives them. */
    const mountPerson = (fields: Partial<Person>, isAdmin = false) => {
      (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        user: ref({ uid: "test-user" }),
        isAdmin: ref(isAdmin),
      });
      return mountSuspended(EntityDetailsCard, {
        props: { entity: { ...person, ...fields } as Person, type: "person" },
      });
    };

    /** The facts line's items, as a reader sees each of them. */
    const facts = async (fields: Partial<Person>) =>
      (await mountPerson(fields))
        .findAll("[data-testid='person-facts'] .entity-facts__item")
        .map((item) => item.text());

    it("is the page's own header, unboxed, the same on a phone as on a computer", async () => {
      // Three lines, the way a company's page opens: the name, one line of
      // facts, one row of controls. The row used to be hidden on a phone, so
      // the change anybody may propose was not on the page at all.
      const wrapper = await mountPerson({ birthDate: "1975-01-16" });

      const header = wrapper.get("header.entity-header");
      expect(header.find(".v-card").exists()).toBe(false);
      for (const testid of ["person-facts", "person-actions"]) {
        const row = header.get(`[data-testid='${testid}']`);
        expect(row.classes()).not.toContain("d-none");
        expect(row.classes()).not.toContain("d-md-flex");
      }
    });

    it("gives the birth date in words, „ur. 16 stycznia 1975”", async () => {
      expect(await facts({ birthDate: "1975-01-16" })).toEqual([
        "ur.\u00a016 stycznia 1975",
      ]);
    });

    it("keeps a birth date that is not a whole day as it was written", async () => {
      // A year a register gave on its own is not a 1 January nobody recorded.
      expect(await facts({ birthDate: "1975" })).toEqual(["ur.\u00a01975"]);
      expect(await facts({ birthDate: "16.01.1975" })).toEqual([
        "ur.\u00a016.01.1975",
      ]);
    });

    it("leaves out a birth date that is blank", async () => {
      expect(
        await facts({ birthDate: " ", wikipedia: "https://pl.wikipedia.org" }),
      ).toEqual(["Wikipedia"]);
    });

    it("labels the education, which bare would read as the person's job", async () => {
      // Production's values are words like „prawnik” and „dziennikarz”.
      const wrapper = await mountPerson({ education: "prawnik" });

      const item = wrapper.get(
        "[data-testid='person-facts'] .entity-facts__item",
      );
      expect(item.get(".entity-facts__label").text()).toBe("wykształcenie:");
      expect(item.text()).toBe("wykształcenie:\u00a0prawnik");
    });

    it("names each profile by the site it is on, with no middot in its text", async () => {
      const wrapper = await mountPerson({
        birthDate: "1975-01-16",
        wikipedia: "https://pl.wikipedia.org/wiki/Jan_Kowalski",
        rejestrIo: "https://rejestr.io/osoby/1/jan-kowalski",
        ktomaco: "https://ktomaco.pl/jan-kowalski",
      });

      const line = wrapper.get("[data-testid='person-facts']");
      expect(
        line.findAll(".entity-facts__item").map((item) => item.text()),
      ).toEqual([
        "ur.\u00a016 stycznia 1975",
        "Wikipedia",
        "Rejestr.io",
        "Kto ma co",
      ]);
      // The dot between them is the stylesheet's, read by nobody.
      expect(line.text()).not.toContain("·");
      expect(line.findAll("a").map((a) => a.attributes("href"))).toEqual([
        "https://pl.wikipedia.org/wiki/Jan_Kowalski",
        "https://rejestr.io/osoby/1/jan-kowalski",
        "https://ktomaco.pl/jan-kowalski",
      ]);
    });

    it("draws no facts line for a person with no facts", async () => {
      const wrapper = await mountPerson({});

      expect(wrapper.find("[data-testid='person-facts']").exists()).toBe(false);
    });

    /** The row's three parts, in order: „Zaproponuj zmianę” (inside its
     * dialog's activator), the vote, the tools' line. */
    const rowParts = async (isAdmin: boolean) => {
      const wrapper = await mountPerson({}, isAdmin);
      // The vote is client-only: it renders once mounted.
      await flushPromises();
      const row = wrapper.get("[data-testid='person-actions']");
      return {
        row,
        parts: [...row.element.children],
        propose: row.get("[data-testid='person-propose-change']"),
        // The vote's arrows: its root is `<client-only>`, which has no
        // element of its own to compare.
        vote: row.findComponent({ name: "ButtonVoteNumber" }).findAll(".v-btn"),
        tools: row.get(".entity-actions__tools"),
      };
    };

    it("leads the row with „Zaproponuj zmianę”, then the vote, then an admin's tools", async () => {
      const { parts, propose, vote, tools } = await rowParts(true);

      // „Zaproponuj zmianę”, the one action every signed in reader has, and
      // how interesting they found the person right after it (Szymon,
      // 2026-10-16), then the tools on a line of their own.
      expect(parts).toHaveLength(3);
      expect(parts[0]!.contains(propose.element)).toBe(true);
      expect(propose.text()).toBe("Zaproponuj zmianę");
      expect(vote).toHaveLength(2);
      expect(vote.every((arrow) => parts[1]!.contains(arrow.element))).toBe(
        true,
      );
      expect(parts[2]).toBe(tools.element);
      expect(tools.findAll(".v-btn").map((button) => button.text())).toEqual([
        "Eksploruj",
        "Rewizje",
        "Ta strona to duplikat",
        "Ta strona to dwie osoby",
      ]);
    });

    it("keeps the same row for a reader with no tools, its tools' line empty", async () => {
      const { parts, propose, vote, tools } = await rowParts(false);

      expect(parts[0]!.contains(propose.element)).toBe(true);
      expect(vote).toHaveLength(2);
      expect(vote.every((arrow) => parts[1]!.contains(arrow.element))).toBe(
        true,
      );
      // Empty, which the stylesheet does not draw (`:empty`).
      expect(tools.text()).toBe("");
      expect(tools.find(".v-btn").exists()).toBe(false);
    });
  });
});

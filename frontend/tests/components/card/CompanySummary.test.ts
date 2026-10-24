import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount } from "@vue/test-utils";
import { h, ref } from "vue";
import { mdiGraphOutline } from "@mdi/js";
import CompanySummary from "../../../app/components/card/CompanySummary.vue";
import ButtonIconAction from "../../../app/components/button/IconAction.vue";
import NoteEditor from "../../../app/components/note/Editor.vue";
import type { Company } from "../../../shared/model";

/** Who is reading: nobody, unless a test signs somebody in. */
const reader = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  admin: false,
}));
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({
    user: ref(reader.user),
    isAdmin: ref(reader.admin),
    isDatascience: ref(false),
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

enableAutoUnmount(afterEach);

const company = {
  id: "chain-company",
  type: "place",
  name: "Firma Testowa",
  regonNumber: "123456785",
  nipNumber: "5260250274",
  krsNumber: "0000357114",
} as Company;

const NBSP = "\u00a0";

describe("CardCompanySummary", () => {
  afterEach(() => {
    reader.user = null;
    reader.admin = false;
    vi.restoreAllMocks();
  });

  it("keeps a register apart from its number", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });
    // The template writes this gap out: whitespace between two tags is dropped
    // by the compiler, and "REGON:123456785" reads as one long number. The
    // linked identifiers lose it the same way, hence KRS here too.
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("REGON: 123456785");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("NIP: 5260250274");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("KRS: 0000357114");
  });

  it("sets its facts on the line a person's page has too, labels apart from values", async () => {
    // „KRS: 0000357114 ↗ · REGON: … · Lokalizacja: … · Wikipedia ↗”: the
    // registers first, then where it sits, then the pages about it.
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: {
          ...company,
          wikipedia: "https://pl.wikipedia.org/wiki/Energa",
        } as Company,
        location: "Powiat Testowy",
      },
    });

    const facts = wrapper.get("[data-testid='company-facts']");
    expect(
      facts.findAll(".entity-facts__item").map((item) => item.text()),
    ).toEqual([
      `KRS:${NBSP}0000357114`,
      `REGON:${NBSP}123456785`,
      `NIP:${NBSP}5260250274`,
      `Lokalizacja:${NBSP}Powiat Testowy`,
      "Wikipedia",
    ]);
    // The labels are the quiet grey of every label on the site, apart from
    // the values in the text's own ink.
    expect(
      facts.findAll(".entity-facts__label").map((label) => label.text()),
    ).toEqual(["KRS:", "REGON:", "NIP:", "Lokalizacja:"]);
  });

  it("links the KRS number to its entry in the register", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: undefined },
    });

    const links = wrapper.findAll("[data-testid='company-facts'] a");
    expect(links.map((link) => link.attributes("href"))).toEqual([
      "https://rejestr.io/krs/0000357114",
    ]);
    // REGON and NIP have no comparable public page.
    expect(wrapper.text()).not.toContain("Lokalizacja");
  });

  it("leads to the company's own page when asked to", async () => {
    // Hyphen-free id: /instytucja/<slug>-<id> reads the id back off the last
    // dash segment, so `chain-company` above would not round-trip.
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: { ...company, id: "ZBcdQ9tUxVyv0o1mnpLH" } as Company,
        location: "Powiat Testowy",
        linkToPage: true,
      },
    });

    const link = wrapper.find("a[href^='/instytucja/']");
    expect(link.attributes("href")).toBe(
      "/instytucja/firma-testowa-ZBcdQ9tUxVyv0o1mnpLH",
    );
    // The name keeps the ink colour it had as a heading, so the arrow is the
    // only thing saying this goes somewhere - and it is under the visual
    // suite's diff threshold, which is why it is asserted here instead.
    expect(link.find(".v-icon").exists()).toBe(true);
  });

  it("links its categories, since nothing around them is a link", async () => {
    // The one caller of ChipCompanyCategories that may: every other one puts
    // the chips inside a row that already links somewhere.
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: { ...company, categories: ["koleje"] } as Company,
        location: "Powiat Testowy",
      },
    });

    expect(wrapper.find("a.v-chip--link").exists()).toBe(true);
  });

  it("links the company's Wikipedia article when it has one, named by the site it is on", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: {
          ...company,
          wikipedia: "https://pl.wikipedia.org/wiki/Energa",
        } as Company,
        location: "Powiat Testowy",
      },
    });

    const fact = wrapper.get("[data-testid='company-wikipedia']");
    const link = fact.get("a");
    expect(link.attributes("href")).toBe(
      "https://pl.wikipedia.org/wiki/Energa",
    );
    expect(link.attributes("target")).toBe("_blank");
    // „Wikipedia ↗”, as on a person's page: it was „Wikipedia: Artykuł z
    // Wikipedii”.
    expect(fact.text()).toBe("Wikipedia");
    expect(fact.find(".entity-facts__label").exists()).toBe(false);
    expect(link.find(".v-icon").exists()).toBe(true);
  });

  it("says nothing about Wikipedia when there is no article", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });

    expect(wrapper.find("[data-testid='company-wikipedia']").exists()).toBe(
      false,
    );
  });

  it("leaves the name as text on the company's own page", async () => {
    // place/DetailView renders this card as the heading of the page it links
    // to, and a heading that links to itself is a dead end.
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });

    expect(wrapper.find("a[href^='/instytucja/']").exists()).toBe(false);
    expect(wrapper.get("h1").text()).toBe("Firma Testowa");
  });

  describe("its row of actions", () => {
    /** The page's own links ride in the row, after the ones that act on the
     * page itself. */
    const withLinks = {
      actions: () =>
        h(ButtonIconAction, { icon: mdiGraphOutline, label: "Graf powiązań" }),
    };

    it("leads with „Zaproponuj zmianę”, then the notes and the page's links, then an admin's tools", async () => {
      reader.user = { uid: "admin" };
      reader.admin = true;
      const wrapper = await mountSuspended(CompanySummary, {
        props: { company, location: "Powiat Testowy" },
        slots: withLinks,
      });

      const row = wrapper.get(".entity-actions");
      expect(row.findAll(".v-btn").map((button) => button.text())).toEqual([
        "Zaproponuj zmianę",
        "Notatki",
        "Graf powiązań",
        "Rewizje",
      ]);
      // The tools on a line of their own, under the reader's actions.
      const tools = row.get(".entity-actions__tools");
      expect(tools.find("[data-testid='admin-revisions-link']").exists()).toBe(
        true,
      );
      expect(tools.text()).not.toContain("Zaproponuj zmianę");
    });

    it("gives a reader who is not an admin no tools", async () => {
      reader.user = { uid: "reader" };
      const wrapper = await mountSuspended(CompanySummary, {
        props: { company, location: "Powiat Testowy" },
      });

      expect(
        wrapper.find("[data-testid='admin-revisions-link']").exists(),
      ).toBe(false);
    });

    it("offers no notes to a logged out reader with none to read", async () => {
      const wrapper = await mountSuspended(CompanySummary, {
        props: { company, location: "Powiat Testowy" },
      });

      expect(wrapper.findAll(".v-btn").map((button) => button.text())).toEqual([
        "Zaproponuj zmianę",
      ]);
    });

    describe("„Notatki” on the company's own page", () => {
      /** The page's notes section, as place/DetailView.vue gives it its id. */
      function notesSection() {
        const section = document.createElement("section");
        section.id = "notatki";
        const heading = document.createElement("h2");
        heading.textContent = "Notatki";
        section.append(heading);
        document.body.append(section);
        const scroll = vi.fn();
        section.scrollIntoView = scroll;
        return { section, heading, scroll };
      }

      afterEach(() => {
        document.getElementById("notatki")?.remove();
      });

      it("takes the reader to the notes the page shows, rather than opening a second editor", async () => {
        reader.user = { uid: "reader" };
        const { heading, scroll } = notesSection();
        const wrapper = await mountSuspended(CompanySummary, {
          props: { company, location: "Powiat Testowy" },
          global: { stubs: { NoteEditor: true } },
        });

        const notes = wrapper
          .findAll(".v-btn")
          .find((button) => button.text() === "Notatki")!;
        await notes.trigger("click");

        expect(scroll).toHaveBeenCalledWith({
          behavior: "smooth",
          block: "start",
        });
        // Focus on the section's heading, as a reading position, so the next
        // Tab carries on from the notes.
        expect(document.activeElement).toBe(heading);
        expect(heading.tabIndex).toBe(-1);
        expect(wrapper.findComponent(NoteEditor).exists()).toBe(false);
        // Still „Notatki”: there is nothing here to hide again.
        expect(notes.text()).toBe("Notatki");
      });

      it("jumps rather than glides for a reader who asked for less motion", async () => {
        reader.user = { uid: "reader" };
        const { scroll } = notesSection();
        vi.spyOn(window, "matchMedia").mockImplementation(
          (query: string) =>
            ({
              matches: query === "(prefers-reduced-motion: reduce)",
              media: query,
            }) as MediaQueryList,
        );
        const wrapper = await mountSuspended(CompanySummary, {
          props: { company, location: "Powiat Testowy" },
        });

        await wrapper
          .findAll(".v-btn")
          .find((button) => button.text() === "Notatki")!
          .trigger("click");

        expect(scroll).toHaveBeenCalledWith({
          behavior: "auto",
          block: "start",
        });
      });
    });

    it("opens the notes under the card in a list, where the card is all there is", async () => {
      reader.user = { uid: "reader" };
      const wrapper = await mountSuspended(CompanySummary, {
        props: {
          company: { ...company, id: "ZBcdQ9tUxVyv0o1mnpLH" } as Company,
          location: "Powiat Testowy",
          linkToPage: true,
        },
        global: { stubs: { NoteEditor: true } },
      });

      const notes = () =>
        wrapper
          .findAll(".v-btn")
          .find((button) => /notatki/i.test(button.text()))!;
      expect(wrapper.findComponent(NoteEditor).exists()).toBe(false);
      await notes().trigger("click");

      expect(wrapper.findComponent(NoteEditor).exists()).toBe(true);
      expect(notes().text()).toBe("Ukryj notatki");
    });
  });
});

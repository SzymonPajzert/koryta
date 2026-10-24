import { describe, it, expect, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import HandoverRow from "../../../app/components/succession/HandoverRow.vue";
import PartyChip from "../../../app/components/PartyChip.vue";
import {
  useSuccessionToday,
  type HandoverSide,
} from "~/composables/successions";

/** The day every spell below is measured to. */
const TODAY = "2026-10-24";

function side(name: string, extra: Partial<HandoverSide> = {}): HandoverSide {
  return {
    name,
    url: `/osoba/${name.toLowerCase().replace(/\s+/g, "-")}-p1`,
    parties: [],
    start: null,
    end: null,
    ...extra,
  };
}

function mountRow(left: HandoverSide, right: HandoverSide, gapDays = 0) {
  return mountSuspended(HandoverRow, { props: { left, right, gapDays } });
}

/** One seat changing hands, drawn the same on a person's page („Zmiany na
 * stanowisku”) and on a company's („Kto kogo zastąpił”): the two pages drew
 * this one fact two ways until Szymon picked one row for both (2026-10-23). */
describe("SuccessionHandoverRow", () => {
  beforeEach(() => {
    // The day the page measures every spell to, carried in the payload: set
    // here so „5 mies.” does not change meaning as the calendar moves.
    useSuccessionToday().value = TODAY;
  });

  it("labels who left and who took the seat, in the order the seat moved", async () => {
    const row = await mountRow(
      side("Hubert Grzegorczyk"),
      side("Marzena Słomka"),
    );

    const left = row.get("[data-testid='handover-left']");
    const right = row.get("[data-testid='handover-right']");
    // Present tense, which Polish does not inflect for gender: one label
    // fits anybody.
    expect(left.get(".handover__label").text()).toBe("Ustępuje");
    expect(left.text()).toContain("Hubert Grzegorczyk");
    expect(right.get(".handover__label").text()).toBe("Obejmuje stanowisko");
    expect(right.text()).toContain("Marzena Słomka");
    // The gap between them in the markup as well as on screen, so a screen
    // reader reads the row in the order the seat moved.
    expect(
      row
        .findAll("[data-testid^='handover-']")
        .map((part) => part.attributes("data-testid")),
    ).toEqual(["handover-left", "handover-gap", "handover-right"]);
  });

  it("links each side to its page, and leaves the page's own person as text", async () => {
    // A link back to the page the reader is on would lead nowhere.
    const row = await mountRow(
      side("Hubert Grzegorczyk"),
      side("Marzena Słomka", { url: undefined }),
    );

    const links = row.findAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.text()).toBe("Hubert Grzegorczyk");
    expect(links[0]!.attributes("href")).toBe("/osoba/hubert-grzegorczyk-p1");
    expect(
      row.get("[data-testid='handover-right'] span.handover__name").text(),
    ).toBe("Marzena Słomka");
  });

  it("prints each side's whole spell in the history's format, and how long it lasted", async () => {
    const row = await mountRow(
      side("Hubert Grzegorczyk", { start: "2025-06-12", end: "2026-04-03" }),
      side("Marzena Słomka", { start: "2026-05-14", end: null }),
      41,
    );

    expect(
      row.get("[data-testid='handover-left'] .handover__period").text(),
    ).toBe("12.06.2025 - 03.04.2026 · 9 mies.");
    // A post still held is measured to today, „od” and no „- obecnie”.
    expect(
      row.get("[data-testid='handover-right'] .handover__period").text(),
    ).toBe("od 14.05.2026 · 5 mies.");
  });

  it("says what the register lacks rather than printing a null", async () => {
    const row = await mountRow(
      side("Jerzy Rzemyszkiewicz", { start: null, end: "2015-05-28" }),
      side("Krzysztof Durkalec"),
    );

    // Only the end: no length, since there is nothing to count it from.
    expect(
      row.get("[data-testid='handover-left'] .handover__period").text(),
    ).toBe("do 28.05.2015");
    expect(
      row.get("[data-testid='handover-right'] .handover__period").text(),
    ).toBe("brak dat kadencji");
    expect(row.text()).not.toContain("null");
    expect(row.text()).not.toContain("undefined");
  });

  it("states the gap the way the site states one everywhere", async () => {
    // `gapLabel` from shared/succession.ts: a seat taken the day it was left,
    // a seat that stood empty, and two filings that disagree.
    const gap = async (days: number) =>
      (await mountRow(side("A B"), side("C D"), days))
        .get("[data-testid='handover-gap']")
        .text();

    expect(await gap(0)).toBe("tego samego dnia");
    expect(await gap(1)).toBe("po 1 dniu przerwy");
    expect(await gap(38)).toBe("po 38 dniach przerwy");
    expect(await gap(-1)).toBe("wpisy nachodzą na siebie o 1 dzień");
    expect(await gap(-19)).toBe("wpisy nachodzą na siebie o 19 dni");
  });

  it("chips the parties of each side", async () => {
    const row = await mountRow(
      side("Hubert Grzegorczyk", { parties: ["PiS"] }),
      side("Marzena Słomka", { parties: ["KO", "PSL"] }),
    );

    expect(
      row
        .get("[data-testid='handover-right']")
        .findAllComponents(PartyChip)
        .map((chip) => chip.props("party")),
    ).toEqual(["KO", "PSL"]);
  });

  describe("the party change", () => {
    const flagged = async (left: string[], right: string[]) =>
      (
        await mountRow(
          side("Hubert Grzegorczyk", { parties: left }),
          side("Marzena Słomka", { parties: right }),
        )
      )
        .find("[data-testid='handover-party-change']")
        .exists();

    it("is flagged when both sides are in parties and share none", async () => {
      const row = await mountRow(
        side("Hubert Grzegorczyk", { parties: ["PiS"] }),
        side("Marzena Słomka", { parties: ["KO"] }),
      );
      expect(row.get("[data-testid='handover-party-change']").text()).toBe(
        "zmiana afiliacji",
      );
    });

    it("is not claimed where either side has no party recorded", async () => {
      // No parties means „not recorded”, not „bezpartyjny”: reading it as a
      // swing would invent one.
      expect(await flagged(["PiS"], [])).toBe(false);
      expect(await flagged([], ["KO"])).toBe(false);
      expect(await flagged([], [])).toBe(false);
    });

    it("is not claimed where the two share a party, in whatever order", async () => {
      expect(
        await flagged(["PiS", "Suwerenna Polska"], ["Suwerenna Polska"]),
      ).toBe(false);
      expect(await flagged(["KO"], ["PSL", "KO"])).toBe(false);
    });

    it("reads the parties of a person stored before 2026-07-28", async () => {
      // `{"0": "PiS"}` rather than an array, passed on as stored.
      const row = await mountRow(
        side("Hubert Grzegorczyk", {
          parties: { 0: "PiS" } as unknown as string[],
        }),
        side("Marzena Słomka", { parties: ["KO"] }),
      );

      expect(
        row
          .get("[data-testid='handover-left']")
          .findComponent(PartyChip)
          .props("party"),
      ).toBe("PiS");
      expect(row.find("[data-testid='handover-party-change']").exists()).toBe(
        true,
      );
    });
  });

  it("gives who left the grey disc and who holds the seat the sage one", async () => {
    const row = await mountRow(
      side("Hubert Grzegorczyk"),
      side("Marzena Słomka"),
    );

    const left = row.get("[data-testid='handover-left'] .initials");
    const right = row.get("[data-testid='handover-right'] .initials");
    expect(left.text()).toBe("HG");
    expect(left.classes()).toContain("initials--out");
    expect(right.text()).toBe("MS");
    expect(right.classes()).toContain("initials--in");
  });
});

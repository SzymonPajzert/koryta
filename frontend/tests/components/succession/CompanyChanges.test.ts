import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import CompanyChanges from "../../../app/components/succession/CompanyChanges.vue";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "../../../server/api/edges/successions.get";

/** What the endpoint will answer with, set by each test before it mounts. */
let response: CompanySuccessions = { successions: [], current: [], hidden: 0 };

registerEndpoint("/api/edges/successions", () => response);

function side(
  name: string,
  extra: Partial<SuccessionSide> = {},
): SuccessionSide {
  return {
    edgeId: `e-${name}`,
    personId: `p-${name}`,
    personName: name,
    parties: [],
    start: null,
    end: null,
    published: true,
    ...extra,
  };
}

function succession(
  left: SuccessionSide,
  joined: SuccessionSide,
  extra: Partial<Succession> = {},
): Succession {
  return {
    companyId: "tauron",
    companyName: "Tauron",
    role: "Zarząd",
    date: joined.start,
    gapDays: 0,
    left,
    joined,
    ...extra,
  };
}

function post(name: string, extra: Partial<CurrentPost> = {}): CurrentPost {
  return {
    edgeId: `e-${name}`,
    personId: `p-${name}`,
    personName: name,
    parties: [],
    role: "Zarząd",
    start: "2024-04-12",
    ...extra,
  };
}

/** A board of `names` all struck off and replaced on `date`, which is the
 * shape the register files a turnover in. */
function turnover(date: string, names: [string, string][], role = "Zarząd") {
  return names.map(([out, into]) =>
    succession(
      side(out, { start: "2016-02-16", end: date }),
      side(into, { start: date, end: null }),
      { role, date },
    ),
  );
}

/** Mounts and waits for the fetch to land.
 *
 * The component does not await its own `authFetch` - Nuxt settles it before
 * serialising a server rendered page, and awaiting would hold a client-side
 * navigation on this one section - so `mountSuspended` returns while the
 * spinner is still on screen.
 */
async function mountChanges(companyId = "tauron") {
  const wrapper = await mountSuspended(CompanyChanges, {
    props: { companyId, companyName: "Tauron Dystrybucja" },
  });
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="successions-relay"]').exists() ||
      wrapper.find('[data-testid="successions-empty"]').exists(),
    { timeout: 5000 },
  );
  return wrapper;
}

describe("SuccessionCompanyChanges", () => {
  beforeEach(() => {
    response = { successions: [], current: [], hidden: 0 };
    // One Nuxt app serves the whole file, so the previous test's answer is
    // still in the payload and the next mount would re-serve it without
    // asking for anything.
    clearNuxtData();
  });

  it("draws a board that turned over on one day as one card", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Radosław Pobol", "Barbara Hanczarek"],
        ["Jakub Dziedzic", "Leszek Kosiorek"],
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    // One decision in the register, so one card - not three.
    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="succession-row"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="batch-count"]').text()).toBe(
      "3 zmiany tego samego dnia",
    );
    // Polish, not the ISO day the endpoint sent.
    expect(wrapper.text()).toContain("12 kwietnia 2024");
    expect(wrapper.text()).not.toContain("2024-04-12");
  });

  it("keeps handovers on different days in separate cards", async () => {
    response = {
      successions: [
        ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
        ...turnover("2023-06-30", [["Waldemar Skomudek", "Maciej Mróz"]]),
      ],
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(2);
    // A single handover is not a batch, so it carries no "N zmian" badge.
    expect(wrapper.findAll('[data-testid="batch-count"]')).toHaveLength(0);
    expect(wrapper.text()).toContain("30 czerwca 2023");
  });

  it("tallies the parties of the people leaving on one day", async () => {
    const [first, second] = turnover("2024-04-12", [
      ["Tomasz Jachna", "Marcin Marzyński"],
      ["Jakub Dziedzic", "Leszek Kosiorek"],
    ]);
    first!.left.parties = ["PiS"];
    second!.left.parties = ["PiS"];

    response = { successions: [first!, second!], current: [], hidden: 0 };

    const wrapper = await mountChanges();

    expect(wrapper.get('[data-testid="batch-parties"]').text()).toContain(
      "wśród ustępujących: 2 × PiS",
    );
  });

  it("splits the relay by role, Zarząd before Rada Nadzorcza", async () => {
    response = {
      successions: [
        ...turnover(
          "2024-05-13",
          [["Wojciech Lutek", "Grzegorz Kuca"]],
          "Rada Nadzorcza",
        ),
        ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
      ],
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const roles = wrapper
      .findAll('[data-testid^="succession-role-"]')
      .map((node) => node.attributes("data-testid"));
    expect(roles).toEqual([
      "succession-role-zarzad",
      "succession-role-rada-nadzorcza",
    ]);
    // Each role batches on its own: two dates, two cards, one row each.
    expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(2);
  });

  it("says how many handovers it will not name", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 4,
    };

    const wrapper = await mountChanges();

    const note = wrapper.get('[data-testid="successions-hidden"]').text();
    expect(note).toContain("4 zmian");
    expect(note).toContain("brakuje strony");
  });

  it("names the current board and how long it has sat", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Krzysztof Durkalec", "Marcin Marzyński"],
      ]),
      current: [post("Marcin Marzyński")],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const composition = wrapper.get('[data-testid="successions-current"]');
    expect(composition.text()).toContain("Marcin Marzyński");
    expect(composition.text()).toContain("od 12 kwietnia 2024");
    // The card names whoever the handover put out of that same seat.
    expect(composition.text()).toContain("wcześniej na tym stanowisku");
    expect(composition.text()).toContain("Krzysztof Durkalec");
  });

  it("orders a board appointed on one day by name, whatever order it arrives in", async () => {
    // A board appointed in one resolution shares a start date to the day, so
    // the date alone cannot order it. `sort` is stable, so before this the
    // order was whatever the endpoint happened to return - and the mobile
    // `instytucja-strona` baseline settled into one of two orderings run to
    // run, failing on whichever it had not recorded by the same 13,220 pixels.
    const names = ["Danuta Obejmująca", "Cezary Obejmujący"];
    const seen: string[][] = [];

    for (const order of [names, [...names].reverse()]) {
      response = {
        successions: [],
        current: order.map((name) => post(name, { role: "Rada Nadzorcza" })),
        hidden: 0,
      };

      const wrapper = await mountChanges();
      // By where each name falls in the rendered text rather than by a class:
      // the only thing under test is which of the two comes first, and this
      // fixture gives the section nothing else to say (no predecessors).
      const text = wrapper.get('[data-testid="successions-current"]').text();
      seen.push(names.map((name) => String(text.indexOf(name))));
      expect(text).toContain("Cezary Obejmujący");
      expect(text).toContain("Danuta Obejmująca");
    }

    // Cezary above Danuta - alphabetical in Polish collation - and the same
    // whichever order the endpoint listed them in.
    for (const positions of seen) {
      expect(Number(positions[1])).toBeLessThan(Number(positions[0]));
    }
  });

  it("says nobody holds an open post rather than heading an empty grid", async () => {
    response = {
      successions: turnover("2024-04-12", [
        ["Tomasz Jachna", "Marcin Marzyński"],
      ]),
      current: [],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.find('[data-testid="current-empty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid^="current-role-"]')).toHaveLength(0);
  });

  it("prints what is missing instead of a null date", async () => {
    response = {
      successions: [
        succession(
          side("Jerzy Rzemyszkiewicz", { start: null, end: "2018-01-17" }),
          side("Krzysztof Durkalec", { start: "2018-01-16", end: null }),
          { date: "2018-01-16", gapDays: -1 },
        ),
      ],
      current: [post("Anna Bez Daty", { start: null })],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.text()).not.toContain("null");
    expect(wrapper.text()).toContain("brak daty rozpoczęcia");
    expect(wrapper.text()).toContain("bez daty powołania");
    // `gapLabel` from shared/succession, so the two filings disagreeing reads
    // as a sentence rather than as a negative number of days.
    expect(wrapper.text()).toContain("wpisy nachodzą na siebie o 1 dzień");
  });

  it("says the whole section is empty rather than heading nothing", async () => {
    response = { successions: [], current: [], hidden: 0 };

    const wrapper = await mountChanges("pusta");

    expect(wrapper.find('[data-testid="successions-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain("Obecny skład");
    expect(wrapper.text()).not.toContain("Kto kogo zastąpił");
    expect(wrapper.text()).toContain("Tauron Dystrybucja");
  });
});

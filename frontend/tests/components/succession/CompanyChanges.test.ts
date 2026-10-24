import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import CompanyChanges from "../../../app/components/succession/CompanyChanges.vue";
import { useSuccessionToday } from "~/composables/successions";
import type { EdgeNode } from "~/composables/edges";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "../../../server/api/edges/successions.get";

// The (i) bubbles are tooltips teleported to <body>, which outlive their
// component: one left open by a test would still be in the document for the
// next.
enableAutoUnmount(afterEach);

/** The day the board is read at and every spell is measured to. */
const TODAY = "2026-10-24";

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
    batchSize: 1,
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
      { role, date, batchSize: names.length },
    ),
  );
}

/** One handover a day on each of `days`, newest first as given. */
function relay(days: string[], role = "Zarząd") {
  return days.flatMap((date, i) =>
    turnover(date, [[`Ustępujący ${i}`, `Obejmujący ${i}`]], role),
  );
}

function answer(fields: Partial<CompanySuccessions> = {}): CompanySuccessions {
  return { successions: [], current: [], hidden: 0, ...fields };
}

/** One of the three parts the company page draws off its one request, handed
 * the answer and the request's state as `useCompanySuccessions` gives them. */
function mountPart(
  part: "current" | "absent" | "relay",
  data: CompanySuccessions | null,
  extra: Record<string, unknown> = {},
) {
  return mountSuspended(CompanyChanges, {
    props: {
      companyName: "Tauron Dystrybucja",
      part,
      data,
      status: "success",
      ...extra,
    },
  });
}

type Wrapper = Awaited<ReturnType<typeof mountPart>>;

/** Opens the part's (i) and hands back the testids of what it says, in
 * order, and the text of each by testid. The tooltip is teleported to <body>. */
async function openInfo(wrapper: Wrapper) {
  await wrapper.get('[data-testid="section-info"]').trigger("click");
  await flushPromises();
  const said = [
    ...document.querySelectorAll<HTMLElement>(".v-overlay__content .why"),
  ];
  return {
    testids: said.map((item) => item.dataset.testid),
    text: (testid: string) =>
      said
        .find((item) => item.dataset.testid === testid)
        ?.textContent.replace(/\u00a0/g, " ")
        .trim(),
  };
}

/** The absent line as a browser sets it, where a run of spaces is one: the
 * line is drawn in two pieces, its last word kept with the (i). */
function absentLine(wrapper: Wrapper): string {
  return wrapper
    .get('[data-testid="company-absent"]')
    .text()
    .replace(/ {2,}/g, " ");
}

/** A row of the page's history, which a card of the current board finds its
 * post in by edge id. */
function edge(id: string, extra: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id,
    type: "employed",
    label: "Zarząd",
    source: `p-${id}`,
    target: "tauron",
    visibility: true,
    richNode: { id: `p-${id}`, type: "person", name: id },
    ...extra,
  } as EdgeNode;
}

describe("SuccessionCompanyChanges", () => {
  beforeEach(() => {
    useSuccessionToday().value = TODAY;
  });

  describe("the request's state", () => {
    it("spins where the people will be until the first answer is in", async () => {
      const current = await mountPart("current", null, { status: "pending" });
      expect(current.find('[data-testid="successions-loading"]').exists()).toBe(
        true,
      );

      // Said once, where the people will be: the other two parts wait quietly.
      for (const part of ["absent", "relay"] as const) {
        const quiet = await mountPart(part, null, { status: "pending" });
        expect(quiet.text()).toBe("");
        expect(quiet.find(".v-progress-circular").exists()).toBe(false);
      }
    });

    it("says the request failed in place of the board, and nothing else", async () => {
      const failed = answer({ current: [post("Marcin Marzyński")] });

      const current = await mountPart("current", failed, { status: "error" });
      expect(current.get('[data-testid="successions-error"]').text()).toBe(
        "Nie udało się wczytać zmian kadrowych. Odśwież stronę.",
      );
      expect(current.text()).not.toContain("Marcin Marzyński");

      for (const part of ["absent", "relay"] as const) {
        const quiet = await mountPart(part, null, { status: "error" });
        expect(quiet.text()).toBe("");
      }
    });

    it("draws only its own part of the answer", async () => {
      const data = answer({
        successions: turnover("2024-04-12", [
          ["Krzysztof Durkalec", "Marcin Marzyński"],
        ]),
        current: [post("Marcin Marzyński")],
      });

      const current = await mountPart("current", data);
      expect(current.find('[data-testid="successions-current"]').exists()).toBe(
        true,
      );
      expect(current.find('[data-testid="successions-relay"]').exists()).toBe(
        false,
      );

      const relayPart = await mountPart("relay", data);
      expect(relayPart.find('[data-testid="successions-relay"]').exists()).toBe(
        true,
      );
      expect(
        relayPart.find('[data-testid="successions-current"]').exists(),
      ).toBe(false);

      // Both sections have something, so there is nothing to say is missing.
      const absent = await mountPart("absent", data);
      expect(absent.text()).toBe("");
    });
  });

  describe("Obecny skład", () => {
    it("names the current board, since when and how long it has sat", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          successions: turnover("2024-04-12", [
            ["Krzysztof Durkalec", "Marcin Marzyński"],
          ]),
          current: [post("Marcin Marzyński", { parties: ["PiS"] })],
        }),
      );

      const composition = wrapper.get('[data-testid="successions-current"]');
      expect(composition.get("h2").text()).toBe("Obecny skład");
      // The day the board is read at, beside the heading.
      expect(composition.get(".sec-head__caption").text()).toBe(
        "wpisy bez daty zakończenia, stan na 24 października 2026",
      );
      const card = composition.get(
        '[data-testid="current-post-e-Marcin Marzyński"]',
      );
      expect(card.text()).toContain("Marcin Marzyński");
      expect(card.text()).toContain("PiS");
      // The day as every row on the site gives it, not „od 12 kwietnia 2024”.
      expect(card.get(".now-pill").text()).toBe("od 12.04.2024");
      expect(card.text()).toContain("2 lata 6 mies. na stanowisku");
      // The card names whoever the handover put out of that same seat.
      expect(card.text()).toContain("wcześniej na tym stanowisku:");
      expect(card.text()).toContain("Krzysztof Durkalec");
      expect(card.text()).not.toContain("m.in.");
    });

    it("hedges the predecessor where a whole board changed that day", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          successions: turnover("2024-04-12", [
            ["Krzysztof Durkalec", "Marcin Marzyński"],
            ["Tomasz Jachna", "Barbara Hanczarek"],
            ["Jakub Dziedzic", "Leszek Kosiorek"],
            ["Radosław Pobol", "Anna Nowak"],
          ]),
          current: [post("Marcin Marzyński")],
        }),
      );

      const hedge = wrapper
        .findAll('[data-testid="current-post-e-Marcin Marzyński"] span')
        .find((span) => span.text() === "m.in.");
      expect(hedge?.attributes("title")).toBe(
        "Tego dnia zmieniły się 4 stanowiska tej samej funkcji. Rejestr nie wskazuje, kto zajął czyje miejsce.",
      );
    });

    it("heads each function with how many hold it, longest-serving first", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          current: [
            post("Anna Nowak", { start: "2025-01-01" }),
            post("Jan Bez Daty", { start: null }),
            post("Ewa Długa", { start: "2019-06-01" }),
          ],
        }),
      );

      const group = wrapper.get('[data-testid="current-role-zarzad"]');
      expect(group.get("h3 .k-group-head__count").text()).toBe("3");
      // A post with no start sorts last rather than reading as the oldest.
      expect(
        group
          .findAll("[data-testid^='current-post-']")
          .map((card) => card.attributes("data-testid")),
      ).toEqual([
        "current-post-e-Ewa Długa",
        "current-post-e-Anna Nowak",
        "current-post-e-Jan Bez Daty",
      ]);
      expect(
        group
          .get('[data-testid="current-post-e-Jan Bez Daty"] .now-pill')
          .text(),
      ).toBe("bez daty powołania");
    });

    // „Kolejność osób - prezes, zastępca prezesa, potem zarząd.” PKP's current
    // board came out as Zarząd, dyrektor…, naczelnik…, prezes, zastępca
    // prezesa: the order knew Zarząd and the supervisory boards and put every
    // other role after them alphabetically, the head of the company among
    // them.
    it("puts the prezes first and the deputies second, then the board", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          current: [
            post("A", { role: "Zarząd" }),
            post("B", { role: "dyrektor Biura Zarządzania Strategicznego" }),
            post("C", { role: "naczelnik w Biurze Spraw Międzynarodowych" }),
            post("D", { role: "prezes" }),
            post("E", { role: "zastępca prezesa" }),
            post("F", { role: "Rada Nadzorcza" }),
          ],
        }),
      );

      const roles = wrapper
        .findAll('[data-testid^="current-role-"]')
        .map((node) => node.attributes("data-testid"));
      expect(roles).toEqual([
        "current-role-prezes",
        "current-role-zastepca-prezesa",
        "current-role-zarzad",
        "current-role-rada-nadzorcza",
        "current-role-dyrektor-biura-zarzadzania-strategicznego",
        "current-role-naczelnik-w-biurze-spraw-miedzynarodowych",
      ]);
    });

    it("ranks the register's longer titles the same way", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          current: [
            post("A", { role: "Członek Zarządu" }),
            post("B", { role: "Wiceprezes Zarządu" }),
            post("C", { role: "Prokurent" }),
            post("D", { role: "Prezes Zarządu" }),
            post("E", { role: "Zastępca Prezesa Zarządu" }),
          ],
        }),
      );

      const roles = wrapper
        .findAll('[data-testid^="current-role-"]')
        .map((node) => node.attributes("data-testid"));
      expect(roles).toEqual([
        "current-role-prezes-zarzadu",
        "current-role-wiceprezes-zarzadu",
        "current-role-zastepca-prezesa-zarzadu",
        "current-role-czlonek-zarzadu",
        "current-role-prokurent",
      ]);
    });

    it("heads a function in sentence case, and names one nobody recorded", async () => {
      const wrapper = await mountPart(
        "current",
        answer({
          current: [
            post("A", { role: "dyrektorka działu obsługi spółki" }),
            post("B", { role: null }),
          ],
        }),
      );

      expect(
        wrapper
          .get(
            '[data-testid="current-role-dyrektorka-dzialu-obslugi-spolki"] h3',
          )
          .text(),
      ).toContain("Dyrektorka działu obsługi spółki");
      expect(
        wrapper.get('[data-testid="current-role-bez-funkcji"] h3').text(),
      ).toContain("Funkcja niepodana w rejestrze");
    });

    it("renders nothing where nobody holds an open post", async () => {
      // The absent line says so instead of a heading over an empty grid.
      const wrapper = await mountPart(
        "current",
        answer({
          successions: turnover("2024-04-12", [
            ["Tomasz Jachna", "Marcin Marzyński"],
          ]),
        }),
      );

      expect(wrapper.text()).toBe("");
      expect(wrapper.findAll('[data-testid^="current-role-"]')).toHaveLength(0);
    });

    /** Today's board is listed only in these cards - the history leaves their
     * posts out (Szymon, 2026-10-23) - so each card carries what its row there
     * had, for whoever may use it. */
    describe("an editor's tools on a card", () => {
      const board = answer({
        current: [post("Marcin Marzyński"), post("Anna Nowak")],
      });

      it("offers the row's sources, correction and bin, off the history's permissions", async () => {
        const row = edge("e-Marcin Marzyński", { references: ["a1", "a2"] });
        const wrapper = await mountPart("current", board, {
          edges: [row],
          canCite: true,
          canCorrect: true,
          canRemove: true,
        });

        const card = wrapper.get(
          '[data-testid="current-post-e-Marcin Marzyński"]',
        );
        expect(card.find(".board-card").classes()).toContain(
          "board-card--tools",
        );
        expect(
          card
            .get('[data-testid="edge-sources-open-e-Marcin Marzyński"]')
            .text(),
        ).toBe("2");

        await card
          .get('[data-testid="edge-edit-e-Marcin Marzyński"]')
          .trigger("click");
        await card
          .get('[data-testid="edge-remove-e-Marcin Marzyński"]')
          .trigger("click");
        await card
          .get('[data-testid="edge-sources-open-e-Marcin Marzyński"]')
          .trigger("click");
        // The relation itself, into the page's own dialogs, as the history's
        // rows hand it.
        expect(wrapper.emitted("edit")?.[0]?.[0]).toBe(row);
        expect(wrapper.emitted("remove")?.[0]?.[0]).toBe(row);
        expect(wrapper.emitted("sources")?.[0]?.[0]).toBe(row);
      });

      it("shows a reader who cannot edit the count of sources and nothing else", async () => {
        const wrapper = await mountPart("current", board, {
          edges: [edge("e-Marcin Marzyński", { references: ["a1"] })],
        });

        const card = wrapper.get(
          '[data-testid="current-post-e-Marcin Marzyński"]',
        );
        expect(
          card
            .find('[data-testid="edge-sources-open-e-Marcin Marzyński"]')
            .exists(),
        ).toBe(true);
        expect(
          card.find('[data-testid="edge-edit-e-Marcin Marzyński"]').exists(),
        ).toBe(false);
        expect(
          card.find('[data-testid="edge-remove-e-Marcin Marzyński"]').exists(),
        ).toBe(false);
      });

      it("draws no tools column on a card with nothing to offer", async () => {
        // Its empty gap would still cost the text 12px.
        const wrapper = await mountPart("current", board, {
          edges: [edge("e-Marcin Marzyński")],
        });

        const card = wrapper.get(
          '[data-testid="current-post-e-Marcin Marzyński"]',
        );
        expect(card.find(".board-card").classes()).not.toContain(
          "board-card--tools",
        );
        expect(card.find("[data-testid^='edge-']").exists()).toBe(false);
      });

      it("marks a draft relation, as its history row did", async () => {
        const wrapper = await mountPart("current", board, {
          edges: [edge("e-Marcin Marzyński", { visibility: false })],
          subjectPublished: true,
        });

        const badge = wrapper
          .get('[data-testid="current-post-e-Marcin Marzyński"]')
          .findComponent({ name: "ChipEdgeDraftStatus" });
        expect(badge.props()).toMatchObject({
          edgeId: "e-Marcin Marzyński",
          published: false,
          publishable: true,
        });
      });

      it("gives a card whose post the page does not hold neither the badge nor the tools", async () => {
        const wrapper = await mountPart("current", board, {
          edges: [edge("e-Marcin Marzyński")],
          canCorrect: true,
        });

        const card = wrapper.get('[data-testid="current-post-e-Anna Nowak"]');
        expect(
          card.findComponent({ name: "ChipEdgeDraftStatus" }).exists(),
        ).toBe(false);
        expect(card.find("[data-testid^='edge-']").exists()).toBe(false);
      });
    });
  });

  describe("Kto kogo zastąpił", () => {
    it("draws a board that turned over on one day as one card", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({
          successions: turnover("2024-04-12", [
            ["Radosław Pobol", "Barbara Hanczarek"],
            ["Jakub Dziedzic", "Leszek Kosiorek"],
            ["Tomasz Jachna", "Marcin Marzyński"],
          ]),
        }),
      );

      // One decision in the register, so one card - not three.
      expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(
        1,
      );
      expect(wrapper.findAll('[data-testid="succession-row"]')).toHaveLength(3);
      // „tego dnia”, not „tego samego dnia”: the gap chip in each row already
      // says that (Szymon, 2026-10-24).
      expect(wrapper.get('[data-testid="batch-count"]').text()).toBe(
        "3 zmiany tego dnia",
      );
      // Polish, not the ISO day the endpoint sent.
      expect(wrapper.get(".ev-date").text()).toBe("12 kwietnia 2024");
      expect(wrapper.text()).not.toContain("2024-04-12");
    });

    it("draws each handover as the row a person's page draws", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({
          successions: turnover("2024-04-12", [
            ["Tomasz Jachna", "Marcin Marzyński"],
          ]),
        }),
      );

      const row = wrapper.get('[data-testid="succession-row"]');
      expect(row.get('[data-testid="handover-left"]').text()).toContain(
        "Ustępuje",
      );
      expect(row.get('[data-testid="handover-left"]').text()).toContain(
        "Tomasz Jachna",
      );
      expect(row.get('[data-testid="handover-right"]').text()).toContain(
        "Obejmuje stanowisko",
      );
      // Both people link to their pages: neither is the page's subject here.
      expect(row.findAll("a").map((a) => a.text())).toEqual([
        "Tomasz Jachna",
        "Marcin Marzyński",
      ]);
      expect(
        row.get('[data-testid="handover-left"] .handover__period').text(),
      ).toBe("16.02.2016 - 12.04.2024 · 8 lat 1 mies.");
    });

    it("keeps handovers on different days in separate cards", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({
          successions: [
            ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
            ...turnover("2023-06-30", [["Waldemar Skomudek", "Maciej Mróz"]]),
          ],
        }),
      );

      expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(
        2,
      );
      // A single handover is not a batch, so it carries no "N zmian" badge.
      expect(wrapper.findAll('[data-testid="batch-count"]')).toHaveLength(0);
      expect(wrapper.text()).toContain("30 czerwca 2023");
    });

    it("never batches the handovers nobody dated", async () => {
      // Those share nothing but the gap in the data.
      const undated = (out: string, into: string) =>
        succession(side(out), side(into), { date: null });
      const wrapper = await mountPart(
        "relay",
        answer({
          successions: [undated("A B", "C D"), undated("E F", "G H")],
        }),
      );

      expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(
        2,
      );
      expect(wrapper.findAll('[data-testid="batch-count"]')).toHaveLength(0);
      expect(wrapper.findAll(".ev-date").map((date) => date.text())).toEqual([
        "Bez daty w rejestrze",
        "Bez daty w rejestrze",
      ]);
    });

    it("tallies the parties of the people leaving on one day", async () => {
      const [first, second] = turnover("2024-04-12", [
        ["Tomasz Jachna", "Marcin Marzyński"],
        ["Jakub Dziedzic", "Leszek Kosiorek"],
      ]);
      first!.left.parties = ["PiS"];
      second!.left.parties = ["PiS"];

      const wrapper = await mountPart(
        "relay",
        answer({ successions: [first!, second!] }),
      );

      expect(wrapper.get('[data-testid="batch-parties"]').text()).toBe(
        "wśród ustępujących: 2 × PiS",
      );
    });

    it("splits the relay by role, Zarząd before Rada Nadzorcza", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({
          successions: [
            ...turnover(
              "2024-05-13",
              [["Wojciech Lutek", "Grzegorz Kuca"]],
              "Rada Nadzorcza",
            ),
            ...turnover("2024-04-12", [["Tomasz Jachna", "Marcin Marzyński"]]),
          ],
        }),
      );

      const roles = wrapper
        .findAll('[data-testid^="succession-role-"]')
        .map((node) => node.attributes("data-testid"));
      expect(roles).toEqual([
        "succession-role-zarzad",
        "succession-role-rada-nadzorcza",
      ]);
      // Each role batches on its own: two dates, two cards, one row each.
      expect(wrapper.findAll('[data-testid="succession-batch"]')).toHaveLength(
        2,
      );
    });

    it("counts the handovers and the functions beside the heading", async () => {
      const caption = async (data: CompanySuccessions) =>
        (await mountPart("relay", data))
          .get('[data-testid="successions-count"]')
          .text();

      expect(
        await caption(
          answer({
            successions: [
              ...relay(["2024-04-12", "2023-06-30", "2022-01-10"]),
              ...relay(["2024-05-13"], "Rada Nadzorcza"),
            ],
          }),
        ),
      ).toBe("4 zmiany w 2 funkcjach");
      expect(
        await caption(answer({ successions: relay(["2024-04-12"]) })),
      ).toBe("1 zmiana w 1 funkcji");
      // And how many it leaves out, so four of sixty never read as the
      // whole register.
      expect(
        await caption(
          answer({ successions: relay(["2024-04-12"]), hidden: 5 }),
        ),
      ).toBe("1 zmiana w 1 funkcji · 5 pominiętych");
    });

    it("says behind its (i) what it leaves out and how the pairs are made", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({ successions: relay(["2024-04-12"]), hidden: 4 }),
      );

      const info = await openInfo(wrapper);
      expect(info.testids).toEqual(["successions-hidden", "relay-method"]);
      expect(info.text("successions-hidden")).toBe(
        "Pominięte zmiany. Nie pokazujemy 4 zmian - brakuje strony jednej z osób. W zestawieniu są tylko te zmiany, w których obie osoby mają u nas swoją stronę.",
      );
      expect(info.text("relay-method")).toBe(
        "Jak dobieramy pary. Pary dobrane 1:1 w obrębie tej spółki i tej samej funkcji: koniec jednego wpisu i początek kolejnego w oknie od 90 dni przed do 120 dni po. Wpisy z tego samego dnia zebrano w jedno zdarzenie.",
      );
    });

    it("says nothing about what it leaves out when it leaves nothing out", async () => {
      const wrapper = await mountPart(
        "relay",
        answer({ successions: relay(["2024-04-12"]) }),
      );

      expect((await openInfo(wrapper)).testids).toEqual(["relay-method"]);
    });

    it("prints what is missing instead of a null date", async () => {
      const data = answer({
        successions: [
          succession(
            side("Jerzy Rzemyszkiewicz", { start: null, end: "2018-01-17" }),
            side("Krzysztof Durkalec", { start: "2018-01-16", end: null }),
            { date: "2018-01-16", gapDays: -1 },
          ),
        ],
        current: [post("Anna Bez Daty", { start: null })],
      });

      const relayPart = await mountPart("relay", data);
      expect(relayPart.text()).not.toContain("null");
      // Only the end: the register never gave the start.
      expect(
        relayPart.get('[data-testid="handover-left"] .handover__period').text(),
      ).toBe("do 17.01.2018");
      // `gapLabel` from shared/succession, so the two filings disagreeing
      // reads as a sentence rather than as a negative number of days.
      expect(relayPart.get('[data-testid="handover-gap"]').text()).toBe(
        "wpisy nachodzą na siebie o 1 dzień",
      );

      const current = await mountPart("current", data);
      expect(current.text()).not.toContain("null");
      expect(current.text()).toContain("bez daty powołania");
    });

    /** PKP LHS has 63 handovers, about 14,000px of a phone - more than the
     * rest of its page together. Each function shows its newest five (Szymon,
     * 2026-10-23). */
    describe("a long relay", () => {
      const days = (count: number) =>
        Array.from({ length: count }, (_, i) => `${2024 - i}-04-12`);

      it("shows the newest five handovers of a function, and the rest behind a button", async () => {
        const wrapper = await mountPart(
          "relay",
          answer({ successions: relay(days(8)) }),
        );

        const batches = wrapper.findAll('[data-testid="succession-batch"]');
        expect(batches.map((batch) => batch.get(".ev-date").text())).toEqual([
          "12 kwietnia 2024",
          "12 kwietnia 2023",
          "12 kwietnia 2022",
          "12 kwietnia 2021",
          "12 kwietnia 2020",
        ]);
        const older = wrapper.get('[data-testid="succession-older-zarzad"]');
        expect(older.text()).toBe("Pokaż starsze (3)");
        expect(older.attributes("aria-expanded")).toBe("false");
        expect(older.attributes("aria-controls")).toBe(
          wrapper.get(".relay-list").attributes("id"),
        );
        // The count beside the head is the whole relay's, folded or not.
        expect(wrapper.get('[data-testid="successions-count"]').text()).toBe(
          "8 zmian w 1 funkcji",
        );
      });

      it("never splits a day's batch to stop at five", async () => {
        // Three single handovers, then a board of four on one day: the fifth
        // falls inside the batch, so the function opens on seven.
        const wrapper = await mountPart(
          "relay",
          answer({
            successions: [
              ...relay(["2024-04-12", "2023-04-12", "2022-04-12"]),
              ...turnover("2021-04-12", [
                ["A A", "B B"],
                ["C C", "D D"],
                ["E E", "F F"],
                ["G G", "H H"],
              ]),
              ...relay(["2020-04-12", "2019-04-12"]),
            ],
          }),
        );

        expect(
          wrapper.findAll('[data-testid="succession-batch"]'),
        ).toHaveLength(4);
        expect(wrapper.findAll('[data-testid="succession-row"]')).toHaveLength(
          7,
        );
        expect(
          wrapper.get('[data-testid="succession-older-zarzad"]').text(),
        ).toBe("Pokaż starsze (2)");
      });

      it("shows a function of five whole, with no button", async () => {
        const wrapper = await mountPart(
          "relay",
          answer({ successions: relay(days(5)) }),
        );

        expect(
          wrapper.findAll('[data-testid="succession-batch"]'),
        ).toHaveLength(5);
        expect(
          wrapper.find('[data-testid="succession-older-zarzad"]').exists(),
        ).toBe(false);
      });

      it("folds each function on its own", async () => {
        const wrapper = await mountPart(
          "relay",
          answer({
            successions: [
              ...relay(days(7)),
              ...relay(days(2), "Rada Nadzorcza"),
            ],
          }),
        );

        expect(
          wrapper.get('[data-testid="succession-older-zarzad"]').text(),
        ).toBe("Pokaż starsze (2)");
        expect(
          wrapper
            .find('[data-testid="succession-older-rada-nadzorcza"]')
            .exists(),
        ).toBe(false);
      });

      it("opens the rest in place, lets the button go and hands focus to the first card it opened", async () => {
        const wrapper = await mountSuspended(CompanyChanges, {
          props: {
            companyName: "Tauron Dystrybucja",
            part: "relay",
            data: answer({ successions: relay(days(8)) }),
            status: "success",
          },
          attachTo: document.body,
        });

        await wrapper
          .get('[data-testid="succession-older-zarzad"]')
          .trigger("click");
        await flushPromises();

        const batches = wrapper.findAll('[data-testid="succession-batch"]');
        expect(batches).toHaveLength(8);
        expect(
          wrapper.find('[data-testid="succession-older-zarzad"]').exists(),
        ).toBe(false);
        expect(wrapper.text()).not.toContain("Pokaż mniej");
        // Where the button was, so a keyboard is not dropped back to the top.
        expect(document.activeElement).toBe(batches[5]!.element);
      });
    });
  });

  /** The one line under the people: which of the two sections the register
   * cannot fill, with the sentences that used to stand in each empty section
   * behind its (i) - hidden, not deleted. */
  describe("what the page does not have", () => {
    it("says in one line that it knows neither the board nor any handover", async () => {
      const wrapper = await mountPart("absent", answer());

      expect(absentLine(wrapper)).toBe(
        "Nie znamy obecnego składu ani zmian na stanowiskach.",
      );
      expect(wrapper.get('[data-testid="company-absent"]').classes()).toEqual([
        "k-note",
        "k-absent",
      ]);
      // No heading over a note that the heading is empty.
      expect(wrapper.find("h2").exists()).toBe(false);

      const info = await openInfo(wrapper);
      expect(info.testids).toEqual(["successions-empty"]);
      expect(info.text("successions-empty")).toBe(
        "Obecny skład i zmiany. Nie mamy wpisów kadencyjnych dla: Tauron Dystrybucja. Kiedy rejestr poda daty powołania i odwołania, pojawi się tu obecny skład i to, kto kogo zastąpił.",
      );
    });

    it("says it does not know the board where only the handovers are known", async () => {
      const wrapper = await mountPart(
        "absent",
        answer({
          successions: turnover("2024-04-12", [
            ["Tomasz Jachna", "Marcin Marzyński"],
          ]),
        }),
      );

      expect(absentLine(wrapper)).toBe("Nie znamy obecnego składu.");
      const info = await openInfo(wrapper);
      expect(info.testids).toEqual(["current-empty"]);
      expect(info.text("current-empty")).toContain(
        "Nie mamy tu nikogo z otwartym wpisem",
      );
    });

    it("says it knows no handover where only the board is known, and how the pairs are made", async () => {
      const wrapper = await mountPart(
        "absent",
        answer({ current: [post("Marcin Marzyński")] }),
      );

      expect(absentLine(wrapper)).toBe("Nie znamy zmian na stanowiskach.");
      // The relay is not drawn, so what its own (i) would say is said here.
      const info = await openInfo(wrapper);
      expect(info.testids).toEqual(["successions-none", "relay-method"]);
      expect(info.text("successions-none")).toBe(
        "Kto kogo zastąpił. Nie dopasowaliśmy tu żadnej zmiany: wpisy, które znamy, nie mają dat, albo nikt nie objął stanowiska w oknie 120 dni od jego zwolnienia.",
      );
    });

    it("says how many handovers it left out where that is why there are none", async () => {
      const wrapper = await mountPart(
        "absent",
        answer({ current: [post("Marcin Marzyński")], hidden: 3 }),
      );

      // No one-letter word at the end of a line: „…jednej z / osób.”
      expect(absentLine(wrapper)).toBe(
        "Pominęliśmy 3 zmiany na stanowiskach, bo brakuje strony jednej z\u00a0osób.",
      );
      const info = await openInfo(wrapper);
      expect(info.testids).toEqual([
        "successions-none",
        "successions-hidden",
        "relay-method",
      ]);
      expect(info.text("successions-hidden")).toContain(
        "Nie pokazujemy 3 zmian",
      );
    });

    it("agrees the count and the seat with one handover left out", async () => {
      const wrapper = await mountPart(
        "absent",
        answer({ current: [post("Marcin Marzyński")], hidden: 1 }),
      );

      expect(absentLine(wrapper)).toBe(
        "Pominęliśmy 1 zmianę na stanowisku, bo brakuje strony jednej z\u00a0osób.",
      );
    });

    it("says both where neither the board nor a named handover is known", async () => {
      const wrapper = await mountPart("absent", answer({ hidden: 2 }));

      expect(absentLine(wrapper)).toBe(
        "Nie znamy obecnego składu. Pominęliśmy 2 zmiany na stanowiskach, bo brakuje strony jednej z\u00a0osób.",
      );
      expect((await openInfo(wrapper)).testids).toEqual([
        "current-empty",
        "successions-none",
        "successions-hidden",
        "relay-method",
      ]);
    });

    it("keeps the line's last word and its (i) together", async () => {
      // So the icon never starts a line on its own.
      const wrapper = await mountPart("absent", answer());

      const tail = wrapper.get(
        '[data-testid="company-absent"] .k-absent__tail',
      );
      expect(tail.text()).toBe("stanowiskach.");
      expect(tail.find('[data-testid="section-info"]').exists()).toBe(true);
    });
  });
});

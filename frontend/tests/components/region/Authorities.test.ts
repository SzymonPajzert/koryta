import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import Authorities from "../../../app/components/region/Authorities.vue";
import {
  governmentSections,
  type AuthorityKind,
  type GovernmentPersonView,
  type GovernmentView,
} from "../../../shared/regionAuthorities";

enableAutoUnmount(afterEach);

function mountView(
  view: GovernmentView | null,
  kind: AuthorityKind,
  props: Record<string, unknown> = {},
) {
  return mountSuspended(Authorities, {
    props: { sections: governmentSections(view, kind), ...props },
    attachTo: document.body,
  });
}

type View = Awaited<ReturnType<typeof mountView>>;

function text(view: View, testid: string): string {
  return view.get(`[data-testid="${testid}"]`).text().replace(/\s+/g, " ");
}

function member(
  name: string,
  over: Partial<GovernmentPersonView> = {},
): GovernmentPersonView {
  return { name, committee: "KWW ŁOWICKIE.PL", ...over };
}

describe("RegionAuthorities", () => {
  it("names a head without a page as text, and one with a page as a link", async () => {
    const view = await mountView(
      {
        election: "local-2024",
        head: {
          ...member("Mariusz Siewiera"),
          office: "Burmistrz",
          member: "Prawo i Sprawiedliwość",
          since: "2024-05-07",
        },
        councils: [],
      },
      "gmina",
    );
    const holder = view.get('[data-testid="region-authorities-holder"]');
    expect(holder.find("a").exists()).toBe(false);
    expect(holder.text()).toContain("Mariusz Siewiera");
    expect(holder.text()).toContain("od 07.05.2024");
    expect(holder.text().replace(/\s+/g, " ")).toContain(
      "Komitet: KWW ŁOWICKIE.PL · członek partii: Prawo i Sprawiedliwość",
    );
    expect(view.text()).toContain("kadencja 2024-2029");

    const linked = await mountView(
      {
        head: {
          ...member("Hanna Zdanowska", {
            page: { id: "p1", published: true, parties: ["PO"] },
          }),
          office: "Prezydent",
        },
        councils: [],
      },
      "miasto",
    );
    const link = linked.get('[data-testid="region-authorities-holder"] a');
    expect(link.text()).toBe("Hanna Zdanowska");
    expect(link.attributes("href")).toContain("p1");
    expect(text(linked, "region-authorities-head")).toContain(
      "Prezydent miasta",
    );
  });

  it("says „Brak danych” in a starosta's slot, with why behind its (i)", async () => {
    const view = await mountView(
      {
        councils: [{ office: "Rada powiatu", members: [member("Anna Nowak")] }],
      },
      "powiat",
    );
    expect(text(view, "region-authorities-head")).toContain("Starosta");
    expect(text(view, "region-authorities-no-head")).toBe("Brak danych");
    expect(
      view
        .find('[data-testid="region-authorities-no-head"] .k-absent__tail')
        .exists(),
    ).toBe(true);
  });

  it("lists every councillor, a name without a page as text, and says how many are not named", async () => {
    const view = await mountView(
      {
        councils: [
          {
            office: "Rada miasta",
            seats: 3,
            members: [
              member("Jakub Wolski", {
                committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
                committeeParties: ["PiS"],
                page: { id: "p1", published: true, parties: ["PiS"] },
              }),
              member("Hubert Krajewski"),
            ],
          },
        ],
      },
      "gmina",
    );
    const rows = view.findAll(".list-member");
    expect(rows.map((row) => row.text().replace(/\s+/g, " "))).toEqual([
      "Jakub Wolski PiS",
      "Hubert Krajewski",
    ]);
    expect(rows[0]!.find("a").exists()).toBe(true);
    expect(rows[1]!.find("a").exists()).toBe(false);
    expect(view.text()).toContain("3 mandaty");
    expect(text(view, "region-authorities-unnamed-Rada miasta")).toBe(
      "Brak danych o jednym radnym.",
    );
  });

  it("sends a city's gmina to the city, and Kraków's to its rada only", async () => {
    const krakow = await mountView(null, "gmina", {
      sections: null,
      pointerTarget: {
        name: "Kraków",
        url: "/region/krakow-teryt1261",
        councilOnly: true,
      },
    });
    expect(text(krakow, "region-authorities-empty")).toBe(
      "Radę miasta pokazujemy na stronie miasta: Kraków.",
    );

    const lodz = await mountView(null, "gmina", {
      sections: null,
      pointerTarget: { name: "Łódź", url: "/region/lodz-teryt1061#wladze" },
    });
    expect(text(lodz, "region-authorities-empty")).toBe(
      "Prezydenta i radę miasta pokazujemy na stronie miasta: Łódź.",
    );
  });

  /** Gmina Łowicz's council in two committees, Jakub Wolski on the second. */
  const council: GovernmentView = {
    councils: [
      {
        office: "Rada miasta",
        seats: 3,
        members: [
          member("Anna Duża", { committee: "KWW ŁOWICKIE.PL" }),
          member("Ewa Duża", { committee: "KWW ŁOWICKIE.PL" }),
          member("Jakub Wolski", {
            committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
            committeeParties: ["PiS"],
            page: { id: "wolski", published: true, parties: ["PiS"] },
          }),
        ],
      },
    ],
  };

  it("opens a council on every committee side by side, a tab each to see one alone", async () => {
    const view = await mountView(council, "gmina", { highlightId: "wolski" });
    const tabs = view.findAll(
      '[data-testid="region-authorities-tabs-Rada miasta"] .v-tab',
    );
    expect(tabs.map((tab) => tab.text().replace(/\s+/g, " "))).toEqual([
      "Wszyscy 3",
      "KWW ŁOWICKIE.PL 2",
      "PiS 1",
    ]);
    const all = () =>
      view.get('[data-testid="region-authorities-all-Rada miasta"]');
    const visible = (element: { element: Element }) =>
      (element.element as HTMLElement).style.display !== "none";
    // „Wszyscy”: a box each, every name.
    expect(visible(all())).toBe(true);
    expect(
      all()
        .findAll(".council-group__head")
        .map((head) => head.text()),
    ).toEqual(["KWW ŁOWICKIE.PL 2", "KW PRAWO I SPRAWIEDLIWOŚĆ 1"]);

    // Each name once in the page, under „Wszyscy”.
    expect(view.findAll(".list-member")).toHaveLength(3);

    // One committee alone, two to a row; „Wszyscy” hidden, still there.
    await tabs[2]!.trigger("click");
    await flushPromises();
    expect(visible(all())).toBe(false);
    const alone = view.get(
      '[data-testid="region-authorities-committee-Rada miasta"]',
    );
    expect(alone.find(".list-members--columns").exists()).toBe(true);
    expect(
      alone.findAll(".list-member__name").map((name) => name.text()),
    ).toEqual(["Jakub Wolski"]);
  });

  it("draws no tabs for a council of one committee", async () => {
    const one: GovernmentView = {
      councils: [
        {
          office: "Rada gminy",
          members: [member("Anna Duża"), member("Ewa Duża")],
        },
      ],
    };
    const view = await mountView(one, "gmina");
    expect(view.find(".council-tabs").exists()).toBe(false);
    expect(view.findAll(".council-column")).toHaveLength(1);
  });
});

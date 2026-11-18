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

  it("opens a long council in place and hands focus to the first member it opened", async () => {
    // Ten seats on one committee and five on another: the fold after twelve
    // cuts the second one short, after its first two.
    const members = [
      ...Array.from({ length: 10 }, (_, index) =>
        member(`Anna ${String.fromCharCode(65 + index)}`, {
          committee: "KKW KOALICJA OBYWATELSKA",
          committeeParties: ["PO"],
          page: { id: `a${index}`, published: true, parties: ["PO"] },
        }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        member(`Bogdan ${String.fromCharCode(65 + index)}`, {
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          committeeParties: ["PiS"],
          page: { id: `b${index}`, published: true, parties: ["PiS"] },
        }),
      ),
    ];
    const view = await mountView(
      { councils: [{ office: "Rada powiatu", seats: 15, members }] },
      "powiat",
    );
    const names = () =>
      view.findAll(".list-member").map((row) => row.get("a").text());
    const before = names();
    expect(before).toHaveLength(12);

    const button = view.get("button.list-more");
    expect(button.attributes("aria-expanded")).toBe("false");
    const box = document.getElementById(button.attributes("aria-controls")!);
    expect(box?.classList.contains("lists-box")).toBe(true);

    await button.trigger("click");
    await flushPromises();

    const after = names();
    expect(after).toHaveLength(15);
    expect(view.find("button.list-more").exists()).toBe(false);
    // Where the button was, so a keyboard is not dropped back to the top.
    const opened = after.find((name) => !before.includes(name));
    expect(document.activeElement?.textContent.trim()).toBe(opened);
    expect(opened).toBe("Bogdan C");
  });
});

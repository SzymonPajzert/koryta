import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ExploreTable from "../../../app/components/explore/Table.vue";
import type { PersonRich } from "../../../shared/model";

/** The two columns /eksploruj/tabela and /eksploruj/nowe now declare where
 * there used to be four: Imię i nazwisko + Partie, and Firmy + Ostatnie
 * zatrudnienie + Wybory. */
const MERGED_HEADERS = [
  { title: "Osoba", key: "name", sortable: true },
  { title: "Historia", key: "latestEmploymentStart", sortable: true },
];

/** Everything the four columns used to carry, on one person, so that the
 * assertions below can say "nothing was dropped on the way" rather than
 * "the markup parses". */
const person = (): PersonRich => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
  parties: ["PiS", "Konfederacja"],
  companies: ["FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"],
  elections: [
    {
      year: "2018",
      location: "Gdynia",
      teryt: "2262",
      position: "Rada miasta",
      committee: "KWW Testowy Komitet",
    },
  ],
  latestEmploymentStart: "2019-03-01",
  experience: 4,
});

const mountTable = () =>
  mountSuspended(ExploreTable, {
    props: {
      headers: MERGED_HEADERS,
      items: [person()],
      totalItems: 1,
      pending: false,
      hideDefaultFooter: true,
    },
  });

describe("ExploreTable's merged person and history cells", () => {
  it("puts the whole row into two cells", async () => {
    const wrapper = await mountTable();

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(2);

    const personCell = cells[0]!;
    expect(personCell.text()).toContain("Jan Kowalski");
    expect(personCell.text()).toContain("PiS");
    expect(personCell.text()).toContain("Konfederacja");

    const historyCell = cells[1]!;
    // `shortCompanyName` takes the legal form out, which is what lets a
    // company chip fit a phone at all.
    expect(historyCell.text()).toContain("FIRMA");
    expect(historyCell.text()).not.toContain("SPÓŁKA Z OGRANICZONĄ");
    expect(historyCell.text()).toContain("2018");
    expect(historyCell.text()).toContain("Gdynia");
    // The date used to be a column of its own behind `hidden-sm-and-down`, so
    // a phone never saw it. It rides with the employers now.
    expect(historyCell.text()).toContain("2019-03-01");
  });

  /** Five e2e specs treat `a.text-primary.cursor-pointer` in the first row as
   * "the table has finished loading", and the drawer opens off its click. The
   * merge moved the link inside a flex wrapper; it must not have moved it out
   * of that selector. */
  it("keeps the name a link that focuses the person", async () => {
    const wrapper = await mountTable();

    const link = wrapper.get("tbody td a.text-primary.cursor-pointer");
    expect(link.text()).toContain("Jan Kowalski");

    await link.trigger("click");
    expect(wrapper.emitted("focus")?.[0]?.[0]).toMatchObject({ id: "p1" });
  });

  /** A person with no employer and no election gets an empty cell rather than
   * a stray "Ostatnie zatrudnienie:" label over an empty chip row. */
  it("leaves the history cell empty when there is nothing to put in it", async () => {
    const wrapper = await mountSuspended(ExploreTable, {
      props: {
        headers: MERGED_HEADERS,
        items: [
          {
            ...person(),
            companies: [],
            elections: [],
            latestEmploymentStart: null,
          },
        ],
        totalItems: 1,
        pending: false,
        hideDefaultFooter: true,
      },
    });

    const cells = wrapper.findAll("tbody td");
    expect(cells[1]!.text()).toBe("");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount } from "@vue/test-utils";
import CompanyTable from "../../../app/components/explore/CompanyTable.vue";
import type { CompanyRow } from "../../../app/utils/companyRows";

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the column menu throws instead of opening.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

enableAutoUnmount(afterEach);

const rows: CompanyRow[] = [
  {
    id: "sukspolka",
    name: "Wojewódzki Zakład Testowy",
    categories: ["szpitale", "koleje"],
    seat: { name: "Powiat Testowy", teryt: "0201" },
    isPublic: true,
    people: 7,
    current: 3,
    latestStart: "2024-04-12",
  },
  {
    id: "company-empty",
    name: "Firma Pusta",
    categories: [],
    people: 0,
    current: 0,
    visibility: false,
  },
];

const mountTable = (props: Record<string, unknown> = {}) =>
  mountSuspended(CompanyTable, {
    props: {
      items: rows,
      totalItems: rows.length,
      pending: false,
      sortBy: [{ key: "people", order: "desc" }],
      ...props,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mountTable>>;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const cells = (wrapper: Wrapper, row: number) => {
  const tr = wrapper.findAll("tbody tr")[row]!;
  return tr.findAll("td").map((cell) => flat(cell.text()));
};

describe("the companies table", () => {
  it("names an institution, its sector, its seat and its people", async () => {
    const wrapper = await mountTable();

    expect(
      wrapper.findAll("thead th").map((cell) => flat(cell.text())),
    ).toEqual(["Spółka", "Branża", "Siedziba", "Osoby"]);

    const [name, , seat, people] = cells(wrapper, 0);
    expect(name).toContain("Wojewódzki Zakład Testowy");
    expect(name).toContain("Instytucja publiczna");
    expect(
      wrapper
        .findAll("tbody tr")[0]!
        .findAll("td")[1]!
        .findAll(".v-chip")
        .map((chip) => flat(chip.text())),
    ).toEqual(["Szpitale", "Koleje"]);
    expect(seat).toBe("Powiat Testowy");
    // The count, how many are there now, and the month the newest post began,
    // with the words that say which fact the date is.
    expect(people).toBe(
      "7 osób w tym 3 obecnie Najnowsze zatrudnienie od kwietnia 2024",
    );
  });

  it("links the name to the institution's own page", async () => {
    const wrapper = await mountTable();

    expect(wrapper.find("a.company-name").attributes("href")).toBe(
      "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
    );
  });

  it("draws a dash, not a zero, for an institution nobody is tied to", async () => {
    const wrapper = await mountTable();

    expect(cells(wrapper, 1)[3]).toBe("—");
    // Nor does it claim anything about who owns it: ownership unknown is the
    // silent case in a list.
    expect(cells(wrapper, 1)[0]).not.toContain("Instytucja publiczna");
  });

  it("says the counts are missing when they did not arrive", async () => {
    // A dash would say „nobody” about every institution on the page.
    const wrapper = await mountTable({ countsUnavailable: true });

    expect(cells(wrapper, 0)[3]).toBe("brak danych");
    expect(cells(wrapper, 1)[3]).toBe("brak danych");
  });

  it("marks a draft for a signed-in reader, and only for one", async () => {
    const guest = await mountTable();
    expect(cells(guest, 1)[0]).not.toContain("szkic");

    const editor = await mountTable({ draftWithName: true });
    expect(cells(editor, 1)[0]).toContain("szkic");
    expect(cells(editor, 0)[0]).not.toContain("szkic");
  });

  it("narrows the list to a sector when its chip is clicked", async () => {
    const wrapper = await mountTable();

    const chip = wrapper
      .findAll("tbody tr")[0]!
      .findAll(".v-chip")
      .find((candidate) => flat(candidate.text()) === "Koleje");
    await chip!.trigger("click");

    expect(wrapper.emitted("category")).toEqual([["koleje"]]);
  });

  it("orders from the column's menu most-first, and flips on a second pick", async () => {
    const wrapper = await mountTable({
      sortBy: [{ key: "name", order: "asc" }],
    });
    // The menu is „Osoby”'s: the name sorts from its header alone.
    const people = wrapper
      .findAllComponents({ name: "ExploreTableColumnHeader" })
      .find((candidate) => candidate.props("column").key === "people");
    expect(
      people!.props("sortOptions").map((o: { key: string }) => o.key),
    ).toEqual(["people", "current", "latestStart"]);

    people!.vm.$emit("sort", "current");
    expect(wrapper.emitted("update:sortBy")?.at(-1)).toEqual([
      [{ key: "current", order: "desc" }],
    ]);

    await wrapper.setProps({ sortBy: [{ key: "current", order: "desc" }] });
    people!.vm.$emit("sort", "current");
    expect(wrapper.emitted("update:sortBy")?.at(-1)).toEqual([
      [{ key: "current", order: "asc" }],
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Table from "../../../app/components/explore/Table.vue";
import type { PersonRich } from "../../../shared/model";

/** The votes column exactly as `/eksploruj/tabela` and `/eksploruj/nowe`
 * declare it. Both spell the key `stats.votes.interesting`, and a Vuetify
 * item slot is named after the column key - so the cell template has to be
 * `item.stats.votes.interesting`. It was `item.votes.interesting`, which
 * matched nothing and fell through to Vuetify's default rendering of the same
 * value; that looked identical while the cell was a bare number, and stopped
 * looking identical the moment it became a component. */
const headers = [
  { title: "Imię i nazwisko", key: "name", sortable: true },
  {
    title: "Głosy łącznie",
    key: "stats.votes.interesting",
    sortable: true,
    align: "center" as const,
  },
];

const person = {
  id: "p1",
  name: "Anna Nowak",
  stats: {
    votes: {
      interesting: 4,
      humanVoted: false,
      models: { "pipeline-capture": 4, "pipeline-pagerank": 2 },
    },
  },
} as unknown as PersonRich;

describe("ExploreTable votes column", () => {
  it("renders the breakdown widget in the total-score cell", async () => {
    const table = await mountSuspended(Table, {
      props: { items: [person], totalItems: 1, pending: false, headers },
    });

    // The widget renders the total inside a button; the dead slot rendered it
    // as bare text.
    const button = table
      .findAll("button")
      .find((b) => b.classes("vote-breakdown-total"));
    expect(button, "the votes cell should render VoteBreakdown").toBeTruthy();
    expect(button!.text()).toContain("4");
  });
});

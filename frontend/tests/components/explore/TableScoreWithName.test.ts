import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ExploreTable from "../../../app/components/explore/Table.vue";
import type { NodeStats, PersonRich } from "../../../shared/model";

/** Only the name column, on purpose: `userVote` would mount ButtonVoteNumber
 * and its firestore composable with it, and none of that is what this asks
 * about. */
const HEADERS = [{ title: "Osoba", key: "name", sortable: false }];

const stats = (interesting: number): NodeStats => ({
  isApproved: false,
  notesCount: 0,
  votes: { interesting },
  edges: {
    all: { experienceMonths: 0, targetNodeIds: [], currentlyEmployed: false },
    approved: {
      experienceMonths: 0,
      targetNodeIds: [],
      currentlyEmployed: false,
    },
  },
});

const person = (): PersonRich => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
  companies: [],
  elections: [],
  experience: 0,
  stats: stats(4),
});

const mountTable = (props: Record<string, unknown> = {}) =>
  mountSuspended(ExploreTable, {
    props: {
      headers: HEADERS,
      items: [person()],
      totalItems: 1,
      pending: false,
      hideDefaultFooter: true,
      ...props,
    },
  });

describe("ExploreTable's scoreWithName", () => {
  /** /eksploruj/nowe dropped the "Głosy łącznie" column to get its table
   * inside its card, but that number is the one its queue is ordered by - so
   * it has to stay on the row somewhere. */
  it("prints the total under the name when the page asks for it", async () => {
    const wrapper = await mountTable({ scoreWithName: true });

    expect(wrapper.get("tbody td").text()).toContain("Suma ocen: 4");
  });

  /** /eksploruj/tabela still declares the column, so its rows must come out
   * exactly as they did. */
  it("says nothing about the score by default", async () => {
    const wrapper = await mountTable();

    expect(wrapper.text()).not.toContain("Suma ocen");
  });

  it("reads a missing total as zero rather than as blank", async () => {
    const wrapper = await mountTable({
      scoreWithName: true,
      items: [{ ...person(), stats: undefined }],
    });

    expect(wrapper.get("tbody td").text()).toContain("Suma ocen: 0");
  });
});

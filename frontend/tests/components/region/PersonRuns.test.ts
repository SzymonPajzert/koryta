import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import PersonRuns from "../../../app/components/region/PersonRuns.vue";
import {
  groupElectionLists,
  personRunsIn,
  type ListMember,
  type RegionRun,
} from "../../../shared/electionLists";

enableAutoUnmount(afterEach);

const person: ListMember = {
  personId: "p1",
  personName: "Anna Radna",
  parties: [],
  published: true,
  offices: ["Rada powiatu"],
  elected: true,
};

/** One run of hers in every local election since 1998: seven, newest first,
 * the newest won. */
const runs: RegionRun[] = [
  "2024",
  "2018",
  "2014",
  "2010",
  "2006",
  "2002",
  "1998",
].map((year) => ({
  edgeId: `e${year}`,
  personId: "p1",
  personName: "Anna Radna",
  parties: [],
  published: true,
  start: `${year}-01-01`,
  position: "Rada powiatu",
  committee: "KWW Nasz Powiat",
  party: null,
  elected: year === "2024",
  byElection: false,
}));

function mountBox() {
  return mountSuspended(PersonRuns, {
    props: {
      person,
      runs: personRunsIn("p1", runs, groupElectionLists(runs)),
      kind: "powiat",
    },
    attachTo: document.body,
  });
}

describe("RegionPersonRuns", () => {
  it("says a won seat without a gender", async () => {
    const box = await mountBox();
    const newest = box.get('[data-testid="person-run-e2024"]');
    expect(newest.text()).toContain("Z mandatem");
    expect(box.text()).not.toContain("Wybrany");
  });

  it("opens the older runs in place and hands focus to the first one it opened", async () => {
    const box = await mountBox();
    const rows = () => box.findAll(".person-run");
    expect(rows()).toHaveLength(5);

    const button = box.get('[data-testid="person-runs-more"]');
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(
      document.getElementById(button.attributes("aria-controls")!)?.tagName,
    ).toBe("OL");

    await button.trigger("click");
    await flushPromises();

    expect(rows()).toHaveLength(7);
    expect(box.find('[data-testid="person-runs-more"]').exists()).toBe(false);
    // Where the button was, so a keyboard is not dropped back to the top.
    expect(document.activeElement).toBe(rows()[5]!.element);
  });
});

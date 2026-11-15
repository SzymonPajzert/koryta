import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PeopleSide from "../../../app/components/oswiadczenia/PeopleSide.vue";
import type { DeclarationPeople } from "../../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../../scripts/declarationPeople";

const trackGoal = vi.fn();
vi.mock("~/composables/analytics", () => ({
  trackGoal: (...args: unknown[]) => trackGoal(...args),
  setGlobalProp: vi.fn(),
}));

const people = seeded as DeclarationPeople;

beforeEach(() => trackGoal.mockClear());

describe("OswiadczeniaPeopleSide", () => {
  it("says what is under way and what is missing, in four lines", async () => {
    const wrapper = await mountSuspended(PeopleSide, { props: { people } });
    const rows = wrapper.findAll(".pside__row").map((row) => row.text());
    expect(rows).toEqual([
      "90czeka na czytelników",
      // Held and mismatched: both wait on an admin.
      "70czeka na decyzję",
      // Cropped and downloaded: both still being prepared.
      "580w przygotowaniu",
      "110bez oświadczenia",
    ]);
  });

  it("drops a line that counts nobody", async () => {
    const wrapper = await mountSuspended(PeopleSide, {
      props: { people: { ...people, reading: 0, cropped: 540 } },
    });
    expect(wrapper.text()).not.toContain("czeka na czytelników");
  });

  it("leads on to reading, the numbers and the post", async () => {
    const wrapper = await mountSuspended(PeopleSide, { props: { people } });
    const read = wrapper.get('[data-testid="people-side-read"]');
    expect(read.text()).toBe("Pomóż szukać");
    expect(wrapper.findComponent({ name: "VBtn" }).props("to")).toBe(
      "/oswiadczenia",
    );
    const links = wrapper.findAll(".pside__links a");
    expect(links.map((a) => [a.text(), a.attributes("href")])).toEqual([
      ["Pełne dane", "/oswiadczenia/postep"],
      ["Dowiedz się więcej", "/blog/sprawdzamy-samorzadowcow"],
    ]);
  });

  it("counts a click on the way on as the panel's pick", async () => {
    const wrapper = await mountSuspended(PeopleSide, { props: { people } });
    await wrapper.findAll(".pside__links a")[0]!.trigger("click");
    expect(trackGoal).toHaveBeenCalledWith("home-explorer:pick", {
      panel: "oswiadczenia",
      value: "postep",
    });
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ChipDeclaredParty from "~/components/chip/DeclaredParty.vue";

/** PKW asks every candidate whether they belong to a party and publishes the
 * answer verbatim. Three states have to survive: a named party, an explicit
 * "no party", and - for most candidacies - no answer at all. */
describe("chip/DeclaredParty", () => {
  const mount = (declaration: string | undefined) =>
    mountSuspended(ChipDeclaredParty, { props: { declaration } });

  it("renders nothing when PKW published no answer", async () => {
    // The common case: the question was only asked in some elections, and
    // never on a council list. An absence must not read as a denial.
    const wrapper = await mount(undefined);
    expect(wrapper.text()).toBe("");
  });

  it("renders nothing for a blank answer", async () => {
    const wrapper = await mount("   ");
    expect(wrapper.text()).toBe("");
  });

  it("says the party, without the sentence PKW wraps it in", async () => {
    const wrapper = await mount(
      "członek partii politycznej: Prawo i Sprawiedliwość",
    );
    expect(wrapper.text()).toContain("Prawo i Sprawiedliwość");
    expect(wrapper.text()).not.toContain("członek partii");
  });

  it("takes a bare party name as it is", async () => {
    // 34.8% of the answers arrive with no lead-in at all.
    const wrapper = await mount("Polskie Stronnictwo Ludowe");
    expect(wrapper.text()).toContain("Polskie Stronnictwo Ludowe");
  });

  it("handles the shorter lead-in too", async () => {
    const wrapper = await mount("członek Polskiego Stronnictwa Ludowego");
    expect(wrapper.text()).toContain("Polskiego Stronnictwa Ludowego");
  });

  it("reads a declared absence of party as its own answer", async () => {
    // This is the one case where the denial is the news: somebody standing on
    // a party committee who told PKW they belong to no party.
    const wrapper = await mount("nie należy do partii politycznej");
    expect(wrapper.text()).toContain("Bezpartyjny");
  });
});

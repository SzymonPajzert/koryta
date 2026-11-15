import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PeoplePanel from "../../../app/components/oswiadczenia/PeoplePanel.vue";
import type { DeclarationPeople } from "../../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../../scripts/declarationPeople";

const people = seeded as DeclarationPeople;

const mount = (snapshot: DeclarationPeople) =>
  mountSuspended(PeoplePanel, {
    props: { people: snapshot },
    global: {
      // The bar and the columns are tested on their own; here only what the
      // panel puts around them.
      stubs: { OswiadczeniaPeopleBar: true, StatsDailyColumns: true },
    },
  });

describe("OswiadczeniaPeoplePanel", () => {
  it("leads with the people published, out of everybody but the namesakes", async () => {
    const wrapper = await mount(people);
    expect(wrapper.get(".ppanel__figure").text()).toBe("300");
    expect(wrapper.get(".ppanel__say").text()).toBe(
      "opublikowanych z 1150 samorządowców",
    );
  });

  it("draws the people a day once there is more than one day", async () => {
    const many = await mount(people);
    expect(many.findComponent({ name: "StatsDailyColumns" }).exists()).toBe(
      true,
    );
    const one = await mount({
      ...people,
      publishedByDay: [{ day: "2026-11-13", count: 300 }],
    });
    expect(one.findComponent({ name: "StatsDailyColumns" }).exists()).toBe(
      false,
    );
  });
});

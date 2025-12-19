import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PartyChip from "../../app/components/PartyChip.vue";
import { partyColors } from "../../shared/misc";

describe("PartyChip", () => {
  it("renders party name", () => {
    const wrapper = mount(PartyChip, {
      props: {
        party: "PiS",
      },
    });

    expect(wrapper.text()).toContain("PiS");
  });

  it("applies correct background color", () => {
    const wrapper = mount(PartyChip, {
      props: {
        party: "PO",
      },
    });

    const span = wrapper.find("span");
    expect(span.attributes("style")).toContain(
      "background-color: " + partyColors["PO"].replace(/,/g, ", "),
    );
  });
});

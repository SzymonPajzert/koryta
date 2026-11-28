import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import AppFooter from "../../../app/components/home/AppFooter.vue";
import { SLACK_INVITE_URL } from "../../../shared/contact";

/** The footer is the whole of how a reader on a phone finds the rest of the
 * site, so the ways to help have to be in it: /pomoc under its own title,
 * and the Slack invite /pomoc offers, beside the other social links. */
describe("HomeAppFooter", () => {
  it("links /pomoc as „Jak możesz pomóc”, under „O projekcie”", async () => {
    const wrapper = await mountSuspended(AppFooter);
    // By the buttons' `to`: a test router renders their anchors without
    // an href.
    const linked = Object.fromEntries(
      wrapper
        .findAllComponents({ name: "VBtn" })
        .filter((button) => button.props("to"))
        .map((button) => [button.props("to"), button.text()]),
    );
    expect(linked["/pomoc"]).toBe("Jak możesz pomóc");
    // „Działaj z nami” still goes to the reading of declarations.
    expect(linked["/oswiadczenia"]).toBe("Działaj z nami");
    const column = wrapper.findAll("p").find((p) => p.text() === "O projekcie")!
      .element.parentElement!;
    expect(column.textContent).toContain("Jak możesz pomóc");
  });

  it("offers the Slack invite /pomoc offers, named for a screen reader", async () => {
    const wrapper = await mountSuspended(AppFooter);
    const slack = wrapper.find(`a[href="${SLACK_INVITE_URL}"]`);
    expect(slack.exists()).toBe(true);
    expect(slack.attributes("aria-label")).toBe("Slack zespołu");
    expect(slack.attributes("target")).toBe("_blank");
    // The same treatment as the other social links: an icon button.
    const facebook = wrapper.find('a[aria-label="Facebook"]');
    expect(slack.classes()).toEqual(facebook.classes());
  });
});

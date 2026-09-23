import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ItemCard from "../../../app/components/qa/ItemCard.vue";
import type { QaCheck, QaItem, QaItemState } from "../../../shared/qa";

const vuetify = createVuetify({ components, directives });

const item: QaItem = {
  id: "example-change",
  title: "Przykładowa zmiana",
  description: "Co się zmieniło.",
  steps: ["Wejdź na stronę", "Kliknij przycisk"],
  link: "/eksploruj/tabela",
  area: "public",
};

const mount = async (
  state: QaItemState = "unchecked",
  overrides: Partial<{
    myCheck: QaCheck | null;
    otherChecks: QaCheck[];
    reportedByOthers: boolean;
    reportIds: string[];
  }> = {},
) =>
  await mountSuspended(ItemCard, {
    global: { plugins: [vuetify] },
    props: {
      item,
      state,
      myCheck: overrides.myCheck ?? null,
      otherChecks: overrides.otherChecks ?? [],
      reportedByOthers: overrides.reportedByOthers ?? false,
      reportIds: overrides.reportIds,
    },
  });

describe("QaItemCard", () => {
  it("shows the steps for an entry nobody has checked", async () => {
    const wrapper = await mount("unchecked");
    expect(wrapper.text()).toContain("Kliknij przycisk");
    expect(wrapper.text()).toContain("Do sprawdzenia");
  });

  it("keeps a confirmed entry collapsed until it is asked for", async () => {
    const wrapper = await mount("ok");
    expect(wrapper.text()).not.toContain("Kliknij przycisk");

    await wrapper.find("button").trigger("click");
    expect(wrapper.text()).toContain("Kliknij przycisk");
  });

  it("emits the verdict together with what was typed", async () => {
    const wrapper = await mount("unchecked");
    await wrapper.find("textarea").setValue("mapa się nie rysuje");

    const issueButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Coś nie działa"));
    await issueButton!.trigger("click");

    expect(wrapper.emitted("save")).toEqual([["issue", "mapa się nie rysuje"]]);
  });

  it("starts from the feedback this reader already wrote", async () => {
    const wrapper = await mount("issue", {
      myCheck: {
        itemId: item.id,
        userUid: "me",
        status: "issue",
        feedback: "wcześniejsza uwaga",
      },
    });
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("wcześniejsza uwaga");
    expect(wrapper.text()).toContain("Twoja ocena: Coś nie działa");
  });

  it("shows what other people reported", async () => {
    const wrapper = await mount("issue", {
      otherChecks: [
        {
          itemId: item.id,
          userUid: "other",
          status: "issue",
          feedback: "u mnie pusto",
        },
      ],
    });
    expect(wrapper.text()).toContain("u mnie pusto");
  });

  it("says when somebody else reported a problem it has not checked off", async () => {
    const wrapper = await mount("unchecked", { reportedByOthers: true });

    // The entry is still this reader's to check - the flag only tells them
    // what to look for.
    expect(wrapper.text()).toContain("Do sprawdzenia");
    expect(wrapper.text()).toContain("Ktoś zgłosił problem");
  });

  it("does not repeat the flag on an entry this reader has reported", async () => {
    const wrapper = await mount("issue", { reportedByOthers: true });
    expect(wrapper.text()).toContain("Zgłoszony problem");
    expect(wrapper.text()).not.toContain("Ktoś zgłosił problem");
  });

  it("opens a confirmed entry that somebody else has flagged", async () => {
    const wrapper = await mount("ok", { reportedByOthers: true });
    expect(wrapper.text()).toContain("Kliknij przycisk");
  });

  it("links to where the change can be seen", async () => {
    const wrapper = await mount("unchecked");
    // Vuetify renders the route through RouterLink, which the test environment
    // stubs out - so the destination is read off the button rather than the
    // markup.
    const open = wrapper
      .findAllComponents({ name: "VBtn" })
      .find((button) => button.text().includes("Otwórz"));
    expect(open?.props("to")).toBe("/eksploruj/tabela");
  });

  it("links every report the change claims to fix to its card on /admin/opinie", async () => {
    const wrapper = await mount("unchecked", {
      reportIds: ["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"],
    });

    const chips = wrapper
      .findAllComponents({ name: "VChip" })
      .filter((chip) => chip.attributes("data-qa-report") !== undefined);
    expect(chips.map((chip) => chip.text())).toEqual([
      "Poprawia zgłoszenie 1",
      "Poprawia zgłoszenie 2",
    ]);
    // RouterLink is stubbed here too, so the destination comes off the props.
    expect(chips.map((chip) => chip.props("to"))).toEqual([
      "/admin/opinie#fb-aaaaaaaaaaaaaaaaaaaa",
      "/admin/opinie#fb-bbbbbbbbbbbbbbbbbbbb",
    ]);
  });

  it("does not number the only report a change fixes", async () => {
    const wrapper = await mount("unchecked", {
      reportIds: ["aaaaaaaaaaaaaaaaaaaa"],
    });

    const chips = wrapper.findAll("[data-qa-report]");
    expect(chips.map((chip) => chip.text())).toEqual(["Poprawia zgłoszenie"]);
  });

  it("shows no report links when the page passes none", async () => {
    // qa.vue leaves `reportIds` out for anyone but an admin.
    const wrapper = await mount("unchecked");
    expect(wrapper.findAll("[data-qa-report]")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Poprawia zgłoszenie");
  });
});

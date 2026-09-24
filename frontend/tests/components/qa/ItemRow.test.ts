import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ItemRow from "../../../app/components/qa/ItemRow.vue";
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
    expanded: boolean;
  }> = {},
) =>
  await mountSuspended(ItemRow, {
    global: { plugins: [vuetify] },
    props: {
      item,
      state,
      myCheck: overrides.myCheck ?? null,
      otherChecks: overrides.otherChecks ?? [],
      reportedByOthers: overrides.reportedByOthers ?? false,
      reportIds: overrides.reportIds,
      expanded: overrides.expanded ?? false,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** The one line, without the open part. */
const line = (wrapper: Wrapper) => wrapper.get("[data-row-toggle]");
const panel = (wrapper: Wrapper) => wrapper.get("[data-row-panel]");

const mine = (
  status: QaCheck["status"],
  feedback?: string,
): Partial<{ myCheck: QaCheck }> => ({
  myCheck: { itemId: item.id, userUid: "me", status, feedback },
});

describe("QaItemRow", () => {
  it("is one line until it is opened, anchored where Slack links to", async () => {
    const wrapper = await mount("unchecked");

    expect(wrapper.get("#qa-example-change").attributes("data-qa-item")).toBe(
      "example-change",
    );
    expect(line(wrapper).text()).toContain("Przykładowa zmiana");
    expect(line(wrapper).text()).toContain("Strona publiczna");
    expect(wrapper.text()).not.toContain("Kliknij przycisk");

    await line(wrapper).trigger("click");
    expect(panel(wrapper).text()).toContain("Kliknij przycisk");
    expect(panel(wrapper).text()).toContain("Co się zmieniło.");
  });

  it("says where the reader stands in words, not only in colour", async () => {
    const wrapper = await mount("unchecked", { expanded: true });

    // The icon on the line carries it for a screen reader...
    expect(line(wrapper).find('[role="img"]').attributes("aria-label")).toBe(
      "Do sprawdzenia",
    );
    // ...and the open row says it outright.
    expect(panel(wrapper).text()).toContain("Do sprawdzenia");
  });

  it("puts this reader's verdict on the line", async () => {
    const wrapper = await mount("issue", mine("issue"));
    expect(line(wrapper).text()).toContain("Coś nie działa");
    expect(wrapper.get("#qa-example-change").classes()).toContain(
      "arow--tone-danger",
    );
  });

  it("emits the verdict together with what was typed", async () => {
    const wrapper = await mount("unchecked", { expanded: true });
    await wrapper.find("textarea").setValue("mapa się nie rysuje");

    const issueButton = panel(wrapper)
      .findAll("button")
      .find((button) => button.text() === "Coś nie działa");
    await issueButton!.trigger("click");

    expect(wrapper.emitted("save")).toEqual([["issue", "mapa się nie rysuje"]]);
  });

  it("keeps what was typed when the row is closed and opened again", async () => {
    const wrapper = await mount("unchecked", { expanded: true });
    await wrapper.find("textarea").setValue("pół zdania");

    await wrapper.setProps({ expanded: false });
    expect(wrapper.find("textarea").exists()).toBe(false);
    await wrapper.setProps({ expanded: true });

    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("pół zdania");
  });

  it("starts from the feedback this reader already wrote", async () => {
    const wrapper = await mount("issue", {
      ...mine("issue", "wcześniejsza uwaga"),
      expanded: true,
    });
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).value,
    ).toBe("wcześniejsza uwaga");
    expect(panel(wrapper).text()).toContain("Twoja ocena: Coś nie działa");
    expect(panel(wrapper).text()).toContain("Zgłoszony problem");
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
      expanded: true,
    });
    expect(panel(wrapper).text()).toContain("Co napisali inni");
    expect(panel(wrapper).text()).toContain("u mnie pusto");
  });

  it("says when somebody else reported a problem it has not checked off", async () => {
    const wrapper = await mount("unchecked", { reportedByOthers: true });

    // The entry is still this reader's to check - the flag only tells them
    // what to look for, and it is on the line, before the row is opened.
    expect(line(wrapper).find('[role="img"]').attributes("aria-label")).toBe(
      "Do sprawdzenia",
    );
    expect(line(wrapper).text()).toContain("Ktoś zgłosił problem");
  });

  it("does not repeat the flag on an entry this reader has reported", async () => {
    const wrapper = await mount("issue", {
      ...mine("issue"),
      reportedByOthers: true,
    });
    expect(line(wrapper).text()).not.toContain("Ktoś zgłosił problem");
  });

  it("links to where the change can be seen", async () => {
    const wrapper = await mount("unchecked", { expanded: true });
    // Vuetify renders the route through RouterLink, which the test environment
    // stubs out - so the destination is read off the button rather than the
    // markup.
    const open = wrapper
      .findAllComponents({ name: "VBtn" })
      .find((button) => button.text().includes("Otwórz"));
    expect(open?.props("to")).toBe("/eksploruj/tabela");
  });

  it("links every report the change claims to fix to its row on /admin/opinie", async () => {
    const wrapper = await mount("unchecked", {
      reportIds: ["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"],
      expanded: true,
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
      expanded: true,
    });

    const chips = wrapper.findAll("[data-qa-report]");
    expect(chips.map((chip) => chip.text())).toEqual(["Poprawia zgłoszenie"]);
  });

  it("shows no report links when the page passes none", async () => {
    // qa.vue leaves `reportIds` out for anyone but an admin.
    const wrapper = await mount("unchecked", { expanded: true });
    expect(wrapper.findAll("[data-qa-report]")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Poprawia zgłoszenie");
  });
});

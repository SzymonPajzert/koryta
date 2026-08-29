import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ItemCard from "../../../app/components/qa/ItemCard.vue";
import type { QaCheck, QaItem, QaItemState } from "../../../shared/qa";
import type { FeedbackStatus, QaAdminResolution } from "../../../shared/model";

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
    adminResolution: QaAdminResolution | null;
    awaitingAcceptance: boolean;
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
      adminResolution: overrides.adminResolution ?? null,
      awaitingAcceptance: overrides.awaitingAcceptance ?? false,
    },
  });

/** This reader's own report on the entry. */
const myReport = (feedback = "mapa się nie rysuje"): QaCheck => ({
  itemId: item.id,
  userUid: "me",
  status: "issue",
  feedback,
});

const closedAs = (status: FeedbackStatus): QaAdminResolution => ({
  itemId: item.id,
  status,
  reportedAt: "2026-08-20T10:00:00.000Z",
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

  it("tells the reader their problem was marked as dealt with", async () => {
    const wrapper = await mount("issue", {
      myCheck: myReport(),
      adminResolution: closedAs("resolved"),
      awaitingAcceptance: true,
    });

    expect(wrapper.text()).toContain("Admin: Załatwione");
    expect(wrapper.text()).toContain("oznaczyliśmy go jako załatwiony");
    expect(wrapper.text()).toContain("Przyjmuję");
    expect(wrapper.text()).toContain("Nadal nie działa");
  });

  it("says what a refusal is, rather than calling it done", async () => {
    const wrapper = await mount("issue", {
      myCheck: myReport(),
      adminResolution: closedAs("wont_fix"),
      awaitingAcceptance: true,
    });

    expect(wrapper.text()).toContain("Admin: Nie robimy");
    expect(wrapper.text()).toContain("oznaczyliśmy, że tego nie zrobimy");
  });

  it("says nothing while the report is still open", async () => {
    const wrapper = await mount("issue", {
      myCheck: myReport(),
      adminResolution: closedAs("in_progress"),
      awaitingAcceptance: false,
    });

    expect(wrapper.text()).not.toContain("Admin:");
    expect(wrapper.text()).not.toContain("Przyjmuję");
  });

  it("stops asking once the closure was accepted", async () => {
    const wrapper = await mount("unchecked", {
      myCheck: {
        ...myReport(),
        acceptedResolutionAt: "2026-08-28T10:00:00.000Z",
      },
      adminResolution: closedAs("resolved"),
      awaitingAcceptance: false,
    });

    expect(wrapper.text()).not.toContain("Przyjmuję");
    expect(wrapper.text()).toContain("czeka na Twoje ponowne sprawdzenie");
    // The stored verdict still says "issue", so neither button may read as
    // this reader's standing answer.
    expect(wrapper.text()).not.toContain("Twoja ocena");
    const variants = wrapper
      .findAllComponents({ name: "VBtn" })
      .filter((b) => ["Działa", "Coś nie działa"].includes(b.text()))
      .map((b) => b.props("variant"));
    expect(variants).toEqual(["outlined", "outlined"]);
  });

  it("takes the closure, or argues with it in the words already there", async () => {
    const wrapper = await mount("issue", {
      myCheck: myReport("filtr nie filtruje"),
      adminResolution: closedAs("resolved"),
      awaitingAcceptance: true,
    });

    const button = (label: string) =>
      wrapper.findAll("button").find((b) => b.text() === label)!;

    await button("Przyjmuję").trigger("click");
    expect(wrapper.emitted("accept")).toHaveLength(1);

    await button("Nadal nie działa").trigger("click");
    // The same verdict it has always emitted, carrying what the reader wrote
    // the first time - the composable is what decides it is news.
    expect(wrapper.emitted("save")).toEqual([["issue", "filtr nie filtruje"]]);
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
});

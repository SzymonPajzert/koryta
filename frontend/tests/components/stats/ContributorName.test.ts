import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { mdiAccountCircle, mdiEyeOffOutline } from "@mdi/js";
import ContributorName from "../../../app/components/stats/ContributorName.vue";
import type { ActivityContributor } from "../../../server/api/stats/activity.get";

type Row = Pick<
  ActivityContributor,
  "name" | "named" | "isSelf" | "photoURL" | "publicName"
>;

const HIDDEN_FROM_OTHERS =
  "To Ty. Inni widzą w tym miejscu zamazaną nazwę — możesz to zmienić w swoim profilu.";
const VISIBLE_TO_ALL = "To Ty. Twoja nazwa jest widoczna dla wszystkich.";

const mountName = (row: Partial<Row>, identified = false) =>
  mountSuspended(ContributorName, {
    props: {
      row: {
        name: "Bartosz Lis",
        named: true,
        isSelf: false,
        photoURL: null,
        ...row,
      },
      identified,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mountName>>;

/** Read off the props: the tooltip itself only renders once hovered. */
const tooltip = (wrapper: Wrapper) =>
  wrapper.findComponent({ name: "VTooltip" }).props("text");
const icon = (wrapper: Wrapper) =>
  wrapper.findComponent({ name: "VIcon" }).props("icon");

describe("StatsContributorName", () => {
  it("tells you your name is hidden when only you see it", async () => {
    // Your own name is always shown to you, so `named` is true here whatever
    // the setting; the tooltip used to read it as "visible to everyone".
    const wrapper = await mountName({
      isSelf: true,
      named: true,
      publicName: false,
    });

    expect(wrapper.text()).toContain("Bartosz Lis");
    expect(tooltip(wrapper)).toBe(HIDDEN_FROM_OTHERS);
    expect(icon(wrapper)).toBe(mdiEyeOffOutline);
  });

  it("tells you your name is public once you made it so", async () => {
    const wrapper = await mountName({
      isSelf: true,
      named: true,
      publicName: true,
    });

    expect(tooltip(wrapper)).toBe(VISIBLE_TO_ALL);
    expect(icon(wrapper)).toBe(mdiAccountCircle);
  });

  it("says the same to an administrator about their own name", async () => {
    const wrapper = await mountName(
      { isSelf: true, named: true, publicName: false },
      true,
    );

    expect(tooltip(wrapper)).toBe(HIDDEN_FROM_OTHERS);
  });

  it("falls back to `named` for a row sent without the answer", async () => {
    const wrapper = await mountName({ isSelf: true, named: false });

    expect(tooltip(wrapper)).toBe(HIDDEN_FROM_OTHERS);
  });

  it("explains somebody else's name by whether they chose to show it", async () => {
    const named = await mountName({ named: true });
    const masked = await mountName({ name: "Anonim 1", named: false });

    expect(tooltip(named)).toContain("zgodziła się");
    expect(icon(named)).toBe(mdiAccountCircle);
    expect(tooltip(masked)).toContain("nie pokazuje");
    expect(icon(masked)).toBe(mdiEyeOffOutline);
  });
});

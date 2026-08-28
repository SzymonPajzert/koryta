import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Breakdown from "../../../app/components/vote/Breakdown.vue";
import type { NodeStats } from "../../../shared/model";

type Votes = NodeStats["votes"];

async function mount(votes?: Votes) {
  return mountSuspended(Breakdown, { props: { votes } });
}

/** The text of the card this test just opened.
 *
 * The menu renders in a teleported overlay, so the component's own wrapper
 * never contains it - and the overlays every earlier test opened are still on
 * `document.body`, so reading the whole body would assert against them too.
 * The last one is this test's.
 */
function overlayText(): string {
  const overlays = document.body.querySelectorAll(".v-overlay__content");
  return overlays[overlays.length - 1]?.textContent ?? "";
}

describe("VoteBreakdown", () => {
  it("shows a plain number when there is nothing behind it", async () => {
    // A column of mostly-unscored people should not fill up with buttons that
    // open an empty card.
    const cell = await mount({ interesting: 0 });

    expect(cell.find("button").exists()).toBe(false);
    expect(cell.text()).toContain("0");
  });

  it("renders the total as the button when there is", async () => {
    const cell = await mount({
      interesting: 4,
      models: { "pipeline-capture": 4 },
    });

    expect(cell.find("button").text()).toContain("4");
  });

  it("names every model that scored the person", async () => {
    const cell = await mount({
      interesting: 5,
      models: { "pipeline-capture": 5, "pipeline-pagerank": 2 },
    });

    await cell.find("button").trigger("click");

    const text = overlayText();
    expect(text).toContain("Oceniona przez 2 modele");
    expect(text).toContain("Przejęta instytucja");
    expect(text).toContain("Sieć powiązań");
  });

  it("says that only the best model counts towards the total", async () => {
    // Six models next to a total of 4 reads as an arithmetic error unless the
    // card says the total takes the maximum rather than the sum.
    const cell = await mount({
      interesting: 4,
      models: { "pipeline-capture": 4, "pipeline-pagerank": 2 },
    });

    await cell.find("button").trigger("click");

    expect(overlayText()).toContain("tylko najwyższa ocena modelu (4)");
  });

  it("counts the people who voted", async () => {
    const cell = await mount({
      interesting: 7,
      humanVoted: true,
      humanCount: 2,
      models: { "pipeline-capture": 3 },
    });

    await cell.find("button").trigger("click");

    const text = overlayText();
    expect(text).toContain("Zagłosowały 2 osoby");
    // 7 total less the best model's 3 is what the people said between them.
    expect(text).toContain("+4");
  });

  it("falls back to humanVoted on an aggregate written before the count", async () => {
    // `humanCount` is absent on every node whose stats predate it, and a 0
    // there means "not recorded" as often as it means "nobody".
    const cell = await mount({
      interesting: 3,
      humanVoted: true,
      models: { "pipeline-capture": 1 },
    });

    await cell.find("button").trigger("click");

    const text = overlayText();
    expect(text).toContain("Głosowali ludzie");
    expect(text).not.toContain("Nikt jeszcze nie głosował");
  });

  it("says so when no model has an opinion", async () => {
    const cell = await mount({
      interesting: 2,
      humanVoted: true,
      humanCount: 1,
    });

    await cell.find("button").trigger("click");

    const text = overlayText();
    expect(text).toContain("Żaden model nie ocenił tej osoby");
    expect(text).toContain("Zagłosowała 1 osoba");
  });

  it("does not attribute a total to people when nobody voted", async () => {
    // An aggregate carrying `models` but no `interesting` - what an interrupted
    // write leaves behind - subtracts to a negative no reader ever cast.
    const cell = await mount({ models: { "pipeline-capture": 3 } });

    await cell.find("button").trigger("click");

    const text = overlayText();
    expect(text).toContain("Nikt jeszcze nie głosował");
    expect(text).not.toContain("sumują się");
  });

  it("names an unlabelled model rather than dropping it", async () => {
    // The pipeline can add or rename a model without this file knowing, and a
    // breakdown that claims to be complete must not silently omit one. There
    // is such a uid in prod today.
    const cell = await mount({
      interesting: 3,
      models: { "pipeline-deepseek-v4-flash-investigator-v0": 3 },
    });

    await cell.find("button").trigger("click");

    expect(overlayText()).toContain("deepseek-v4-flash-investigator-v0");
  });
});

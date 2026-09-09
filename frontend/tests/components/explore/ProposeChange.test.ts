import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import ProposeChange from "../../../app/components/explore/ProposeChange.vue";
import { AA_TEXT, brand, contrastRatio, ink } from "../../../shared/colors";
import type { PersonRich } from "../../../shared/model";

const person = (): PersonRich => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
});

/** Vuetify's tonal variant lays the colour under itself at
 * `--v-activated-opacity` (0.12) and writes the same colour as the label, so
 * the pair on screen is the colour over its own 12% wash on white. */
const overWhite = (colour: string, alpha: number) =>
  `#${[1, 3, 5]
    .map((start) =>
      Math.round(
        parseInt(colour.slice(start, start + 2), 16) * alpha +
          255 * (1 - alpha),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const TONAL_UNDERLAY_OPACITY = 0.12;

const mount = () =>
  mountSuspended(ProposeChange, { props: { person: person() } });

describe("ExploreProposeChange", () => {
  /** The button the drawer opens the edit dialog with. `color="warning"` on a
   * tonal button writes Vuetify's #fb8c00 as the label, which the review
   * measured at 2.14:1 on the wash under it. */
  it("labels the edit button in the palette's warning ink", async () => {
    const wrapper = await mount();

    const button = wrapper.find(".v-btn");
    expect(button.text()).toContain("Zaproponuj zmianę");
    expect(button.classes()).toContain("text-ink-warning");
    expect(button.classes()).toContain("v-btn--variant-tonal");

    const background = overWhite(ink.warning, TONAL_UNDERLAY_OPACITY);
    expect(contrastRatio(ink.warning, background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    // The colour it replaced, on the same wash, as the failure it was.
    expect(
      contrastRatio("#fb8c00", overWhite("#fb8c00", TONAL_UNDERLAY_OPACITY)),
    ).toBeLessThan(AA_TEXT);
  });

  /** „Mamy teraz w sidebarze »zgłoś poprawkę« i »zaproponuj zmianę«, nie
   * wiadomo co do tego służy i po co są dwa”. Both stay - one files a revision
   * on the record's own fields, the other is free text an admin reads - so
   * this one says which fields it covers, and gets out of the way once a
   * change has been submitted. */
  it("says which fields the proposed change covers", async () => {
    const wrapper = await mount();

    const caption = wrapper.get("p.k-lead");
    expect(caption.text()).toContain("Poprawia metryczkę");
    expect(caption.text()).toContain("notatce niżej");

    const dialog = wrapper.findComponent({ name: "DialogProposeEditNode" });
    dialog.vm.$emit("submitted", "rev-1");
    await nextTick();

    expect(wrapper.find("p.k-lead").exists()).toBe(false);
  });

  /** The confirmation a reader gets after submitting a change, and the link in
   * it is the only way to see what they submitted. It was `text-primary` on a
   * tinted alert: 1.63:1. */
  it("paints the preview link in the palette's info ink once a change is submitted", async () => {
    const wrapper = await mount();
    expect(wrapper.find(".v-alert").exists()).toBe(false);

    const dialog = wrapper.findComponent({ name: "DialogProposeEditNode" });
    dialog.vm.$emit("submitted", "rev-1");
    await nextTick();

    const alert = wrapper.find(".v-alert");
    expect(alert.exists()).toBe(true);
    expect(alert.classes()).toContain("text-ink-info");

    const link = alert.find("a");
    expect(link.text()).toContain("Podgląd zmiany");
    expect(link.attributes("href")).toBe(
      "/osoba/jan-kowalski-p1?revisionId=rev-1",
    );
    // Named on the anchor rather than inherited: an `<a>` with no colour of
    // its own falls back to the browser's link blue.
    expect(link.classes()).toContain("text-ink-info");
    // The colour it carries no longer distinguishes it from the sentence it
    // sits in, so the underline has to.
    expect(link.classes()).toContain("text-decoration-underline");
    expect(link.classes()).not.toContain("text-primary");

    const background = overWhite(ink.info, TONAL_UNDERLAY_OPACITY);
    expect(contrastRatio(ink.info, background)).toBeGreaterThanOrEqual(AA_TEXT);
    // What was there: the brand fill as ink, on the wash Vuetify's own info
    // blue laid under it. 1.63:1, the worst pair the review found on the page,
    // and worse than the 1.85:1 the same colour makes on plain white because
    // the background is tinted away from it.
    expect(
      Math.round(
        contrastRatio(
          brand.primary,
          overWhite("#2196f3", TONAL_UNDERLAY_OPACITY),
        ) * 100,
      ) / 100,
    ).toBe(1.63);
  });
});

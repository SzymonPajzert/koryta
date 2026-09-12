import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PersonRow from "../../../app/components/badge/PersonRow.vue";
import type { BadgeTally } from "../../../shared/badges";

/** A tally shaped like the one `computeBadgeStats` writes: keyed by the bare
 * badge id, with no `badge:` prefix - the prefix only exists inside a vote
 * document's `categoryVotes`. */
const tally = (up: number, down = 0): BadgeTally => ({ up, down });

async function row(props: {
  stats?: Record<string, BadgeTally>;
  moderation?: Record<string, "approved" | "hidden">;
  ids?: string[];
  signedIn?: boolean;
}) {
  const wrapper = await mountSuspended(PersonRow, { props });
  return {
    /** Every chip's text, in render order. */
    titles: () => wrapper.findAll(".v-chip").map((chip) => chip.text()),
    /** Vuetify puts the variant in a class, so this is how „filled, because
     * the site stands behind it” is told apart from „outlined, because readers
     * are still arguing”. */
    variants: () =>
      wrapper
        .findAll(".v-chip")
        .map((chip) =>
          chip.classes().find((c) => c.startsWith("v-chip--variant-")),
        ),
    colours: () =>
      wrapper
        .findAll(".v-chip")
        .map((chip) => chip.classes().filter((c) => c.startsWith("bg-"))),
    /** The tooltip text lives on the VTooltip's prop: the overlay itself is
     * lazy and teleported, so nothing is in the DOM until a pointer opens it,
     * and there is no pointer here. */
    tooltips: () =>
      wrapper
        .findAllComponents({ name: "VTooltip" })
        .map((tip) => String(tip.props("text"))),
    /** Whether the wrapping flex row exists at all. Not `wrapper.html()`: the
     * template's own comments are part of the rendered output in a dev build,
     * so an empty component is a paragraph of prose plus `<!--v-if-->`. */
    hasRow: () => wrapper.find("div").exists(),
  };
}

describe("BadgePersonRow", () => {
  it("shows a badge past the threshold to everybody, filled", async () => {
    // „Społecznik” is the one badge with requiresApproval: false, so three
    // readers are the whole gate - no editor in the way.
    const r = await row({ stats: { spolecznik: tally(3) }, signedIn: false });
    expect(r.titles()).toEqual(["🤲Społecznik"]);
    expect(r.variants()).toEqual(["v-chip--variant-flat"]);
    // Filled and not tonal: tonal would draw the label in this theme's primary
    // on its own wash, 1.73:1 (chip/PublicCompany.vue:4-8).
    expect(r.colours()).toEqual([["bg-primary"]]);
  });

  it("carries the badge's claim in the tooltip", async () => {
    const r = await row({ stats: { spolecznik: tally(3) } });
    expect(r.tooltips()[0]).toContain("zasiada w organie, za który się nie");
  });

  it("shows a proposal to a signed-in reader, outlined and labelled", async () => {
    const r = await row({ stats: { omnibus: tally(1) }, signedIn: true });
    expect(r.titles()).toEqual(["🚌Omnibus"]);
    expect(r.variants()).toEqual(["v-chip--variant-outlined"]);
    // No colour at all on the outlined states: the border is the signal, and a
    // primary outline would read as the same endorsement the filled chip is.
    expect(r.colours()).toEqual([[]]);
    expect(r.tooltips()[0]).toContain("Propozycja czytelników");
  });

  it("hides a proposal from a logged-out visitor", async () => {
    // The point of the whole gate: one reader's unreviewed opinion about a
    // named living person never appears on the public page.
    const r = await row({ stats: { omnibus: tally(1) }, signedIn: false });
    expect(r.titles()).toEqual([]);
  });

  it("says so when a badge has the votes but not the editor", async () => {
    // Three readers, requiresApproval, nothing in badgeModeration.
    const r = await row({ stats: { omnibus: tally(3) }, signedIn: true });
    expect(r.variants()).toEqual(["v-chip--variant-outlined"]);
    expect(r.tooltips()[0]).toContain("Czeka na zatwierdzenie redakcji");
  });

  it("hides an unapproved badge from a logged-out visitor", async () => {
    const r = await row({ stats: { omnibus: tally(3) }, signedIn: false });
    expect(r.titles()).toEqual([]);
  });

  it("publishes an approved badge to everybody", async () => {
    const r = await row({
      stats: { omnibus: tally(3) },
      moderation: { omnibus: "approved" },
      signedIn: false,
    });
    expect(r.titles()).toEqual(["🚌Omnibus"]);
    expect(r.variants()).toEqual(["v-chip--variant-flat"]);
  });

  it("renders nothing for a badge an editor hid, however many votes it has", async () => {
    // An editor's "no" outranks any number of readers, and it outranks them
    // for signed-in readers too - the voting control is where a blocked badge
    // is still listed, not this row.
    for (const signedIn of [true, false]) {
      const r = await row({
        stats: { omnibus: tally(30) },
        moderation: { omnibus: "hidden" },
        signedIn,
      });
      expect(r.titles()).toEqual([]);
    }
  });

  it("drops a badge the dissenters have talked down to parity", async () => {
    const r = await row({ stats: { omnibus: tally(3, 3) }, signedIn: true });
    expect(r.titles()).toEqual([]);
  });

  it("renders no row at all when nobody has voted", async () => {
    // Not an empty <div>: in EntityDetailsCard's `ga-2` header row an empty
    // flex item would still add 8px next to the person's name, on nearly every
    // person on the site.
    const r = await row({ signedIn: true });
    expect(r.hasRow()).toBe(false);
  });

  it("survives a person document with no stats and no moderation", async () => {
    const r = await row({});
    expect(r.titles()).toEqual([]);
  });

  it("orders the strongest badge first", async () => {
    const r = await row({
      stats: {
        spolecznik: tally(3),
        omnibus: tally(9),
        "zmiana-barw": tally(4),
      },
      moderation: { omnibus: "approved", "zmiana-barw": "approved" },
      signedIn: false,
    });
    expect(r.titles()).toEqual(["🚌Omnibus", "🎨Zmiana barw", "🤲Społecznik"]);
  });

  it("renders the ids a feed card hands it, in the order given", async () => {
    // The feed has already run `publicBadgeIds` on the server, so there are no
    // tallies here to re-derive anything from - and the order it chose (by
    // support) has to survive, or the card and the person page disagree about
    // which badge comes first.
    const r = await row({ ids: ["zmiana-barw", "spolecznik"] });
    expect(r.titles()).toEqual(["🎨Zmiana barw", "🤲Społecznik"]);
    expect(r.variants()).toEqual([
      "v-chip--variant-flat",
      "v-chip--variant-flat",
    ]);
  });

  it("shows the ids to a logged-out visitor without being told twice", async () => {
    // `publicBadgeIds` already applied the rule; `signedIn` must not gate it
    // again, or the feed would go blank for exactly the readers it is for.
    const r = await row({ ids: ["spolecznik"], signedIn: false });
    expect(r.titles()).toEqual(["🤲Społecznik"]);
  });

  it("ignores an id that is not in the catalogue instead of blowing up", async () => {
    // A feed entry outlives the catalogue: an id written months ago may have
    // been retired since. A person's card must not fail over a label.
    const r = await row({ ids: ["nie-ma-takiej", "spolecznik", ""] });
    expect(r.titles()).toEqual(["🤲Społecznik"]);
  });

  it("ignores a stray key on stats.badges", async () => {
    // `categoryVotes` is a free-form map any signed-in client can write, so
    // `badge:cokolwiek` reaches Firestore whatever the UI offers. The
    // catalogue, not the document, decides what renders.
    const r = await row({
      stats: { cokolwiek: tally(50), spolecznik: tally(3) },
      signedIn: true,
    });
    expect(r.titles()).toEqual(["🤲Społecznik"]);
  });
});

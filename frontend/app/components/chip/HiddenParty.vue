<template>
  <!-- Where a party chip would stand, for a person whose party a logged out
       reader is not shown: the page knows there is one, and the chip says so.
       Never the party itself, which is not in the page at all -
       `/api/edges/successions` and the teaser send only that there is one.

       Szymon's pick of 2026-10-24, after rounds of renders: „???” rather than a
       word, in the grey of the „Inne” chip, with dots of the parties' colours
       at its edges, none under the marks - a party chip whose party is not
       said. Not a link: a chip that led to the sign in was a surprise
       (Szymon, 2026-10-24). Pointed at, focused or tapped, it says what it
       stands for; the sign-in buttons are the banner's. -->
  <span
    class="hidden-party"
    :style="paint"
    tabindex="0"
    :aria-label="explanation"
    data-testid="hidden-party"
    data-nosnippet
  >
    <span class="hidden-party__dots" :style="dots" aria-hidden="true" />
    <span aria-hidden="true">???</span>
    <v-tooltip
      activator="parent"
      location="top"
      max-width="280"
      data-testid="hidden-party-tooltip"
    >
      {{ explanation }}
    </v-tooltip>
  </span>
</template>

<script setup lang="ts">
import { OTHER_PARTY, partyChipPaint, partyColors } from "~~/shared/misc";
import { ink } from "~~/shared/colors";

/** The stand-in for a party chip (`PartyChip`) that a logged out reader is not
 * shown. */

const explanation =
  "Informacja o partii nie jest jeszcze zweryfikowana. Widoczna tylko dla zalogowanych.";

/** The „Inne” chip's fill, with the strong ink rather than its own grey: the
 * marks are the whole label, and its grey on the dots read faint. */
const paint = {
  backgroundColor: partyChipPaint(OTHER_PARTY)!.backgroundColor,
  color: ink.strong,
};

/** Six dots at the chip's edges and corners, never under the marks: where
 * each sits (% of the chip), how big (px), and whose colour. */
const DOTS: [number, number, number, string][] = [
  [8, 24, 2.2, "PiS"],
  [7, 78, 1.6, "PO"],
  [33, 10, 1.8, "PSL"],
  [66, 90, 1.8, "Nowa Lewica"],
  [92, 20, 1.6, "Polska 2050"],
  [91, 76, 2.2, "PSL"],
];

const dots = {
  backgroundImage: DOTS.map(
    ([x, y, r, party]) =>
      `radial-gradient(circle at ${x}% ${y}%, ${partyColors[party]} 0 ${r}px, transparent ${r + 0.6}px)`,
  ).join(", "),
};
</script>

<style scoped>
/* `PartyChip`'s box at its own size - padding, radius, weight and the type it
   inherits - so the stand-in is as tall as the party chips beside it. The
   help cursor: there is something to read here, and nothing to follow. */
.hidden-party {
  align-items: center;
  align-self: center;
  border-radius: 0.3rem;
  cursor: help;
  display: inline-flex;
  font-weight: 550;
  isolation: isolate;
  padding: 0.1rem 0.4rem;
  position: relative;
  white-space: nowrap;
}

.hidden-party:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-neutral));
  outline-offset: 2px;
}

/* Under the marks, inside the chip's own corners. */
.hidden-party__dots {
  border-radius: inherit;
  inset: 0;
  opacity: 0.9;
  overflow: hidden;
  position: absolute;
  z-index: -1;
}
</style>

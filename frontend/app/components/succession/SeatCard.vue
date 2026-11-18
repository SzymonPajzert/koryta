<template>
  <div class="k-card k-card--accent pa-4 pl-5 h-100">
    <div class="board-card" :class="{ 'board-card--tools': tools }">
      <SuccessionInitials class="board-card__avatar" :name tone="in" />
      <div class="board-card__text">
        <div class="d-flex align-center flex-wrap ga-2">
          <!-- `nofollow` to a page nobody has published: for a
               logged out reader, and so for a crawler, it is the
               teaser, which answers 404. -->
          <NuxtLink
            v-if="url"
            :to="url"
            :rel="published ? undefined : 'nofollow'"
            class="link-plain text-subtitle-1 font-weight-bold"
            >{{ name }}</NuxtLink
          >
          <!-- No page, or none this reader may open: a region's head as PKW
               names them, as text. -->
          <span v-else class="text-subtitle-1 font-weight-bold">{{
            name
          }}</span>
          <PartyChip v-for="party in parties" :key="party" :party />
          <!-- The party of an unpublished holder, which a logged
               out reader is told is there and not what it is. -->
          <ChipHiddenParty v-if="partyHidden" />
        </div>

        <div
          v-if="since || draws(slots['after-pill']?.())"
          class="d-flex align-center flex-wrap ga-2 mt-2"
        >
          <span v-if="since" class="now-pill">
            <v-icon :icon="mdiCalendarBlankOutline" size="13" />
            {{ since }}
          </span>
          <slot name="after-pill" />
        </div>

        <slot name="details" />
      </div>

      <slot name="tools" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { mdiCalendarBlankOutline } from "@mdi/js";
import { Comment, Fragment, isVNode } from "vue";

/** Who holds a seat now, as a card: their initials, their name and parties,
 * since when, and whatever else the page knows about the post. The company
 * page's „Obecny skład” draws its board in these (`CompanyChanges`), and a
 * region's „Władze” the head of its executive.
 *
 * Attributes a caller sets (`data-testid`, `aria-current`) land on the outer
 * box, the `k-card`. */
defineProps<{
  /** The holder's name: the link, and the letters on the disc. */
  name: string;
  /** Their page. Without one the name is text. */
  url?: string;
  /** Whether their page is live. A link to one that is not is `nofollow`. */
  published: boolean;
  /** Their parties, a chip each, after the name. */
  parties: string[];
  /** A party the reader is not told, for a reader who is not signed in: a
   * chip that says there is one (`ChipHiddenParty`). */
  partyHidden?: boolean;
  /** The pill's text, in the caller's words: the company page gives the day
   * as every row on the site does, „od 14.05.2026”. No pill without one. */
  since?: string;
  /** Reserves the column of the `tools` slot. Without it the text takes the
   * card's whole width: an empty column's gap would still cost it 12px. */
  tools?: boolean;
}>();

const slots = defineSlots<{
  /** On the pill's line, after it: the company page's time in the post and
   * its draft badge. With neither this nor a pill, the line is not drawn. */
  "after-pill"?: () => unknown;
  /** Under the pill's line, as blocks: whoever held the seat before, the list
   * a mayor was elected from. */
  details?: () => unknown;
  /** The tools column: beside the name on a computer, under the text on a
   * phone. It has a column only with `tools` set. */
  tools?: () => unknown;
}>();

/** Whether a slot draws anything, by the test Vue's own `<slot>` puts it to
 * before falling back to its default content: a `v-if` that came out false
 * leaves a comment, which draws nothing. */
function draws(nodes: unknown): boolean {
  return (
    Array.isArray(nodes) &&
    nodes.some(
      (node) =>
        !isVNode(node) ||
        (node.type !== Comment &&
          (node.type !== Fragment || draws(node.children))),
    )
  );
}
</script>

<style scoped>
/* Who, then what the post is; with an editor's tools for it at the card's
   edge, on the name's line, where the history's rows keep theirs. On the
   name's line rather than centred: cards of one row are as tall as the
   tallest, so tools centred on each card's own text zigzagged across the
   row. Only a card with tools has their column, or its empty gap would
   still cost the text 12px. */
.board-card {
  align-items: start;
  column-gap: 12px;
  display: grid;
  grid-template-areas: "avatar text";
  grid-template-columns: auto minmax(0, 1fr);
}

.board-card--tools {
  grid-template-areas: "avatar text tools";
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.board-card__avatar {
  grid-area: avatar;
}

.board-card__text {
  grid-area: text;
  min-width: 0;
}

/* Whatever the `tools` slot holds is the column. The slot adds no box of
   its own, so its content stands in the grid itself, and needs no class to
   find its place there. The other two slots are inside the text, out of
   this selector's reach. */
.board-card > :slotted(*) {
  align-self: start;
  grid-area: tools;
}

/* Sage behind ink rather than as ink: the one thing a reader scanning the
   section is looking for is who is in the seat now. */
.now-pill {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: inline-flex;
  font-size: var(--k-meta-size);
  font-weight: 600;
  gap: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}

/* ---- phone ---- */
@media (max-width: 599.98px) {
  /* An editor's tools take the card's last line, at its right edge, where
     the history's rows put theirs on a phone: beside the name they would
     leave it about 110px. */
  .board-card--tools {
    grid-template-areas:
      "avatar text"
      ". tools";
    grid-template-columns: auto minmax(0, 1fr);
  }

  .board-card > :slotted(*) {
    justify-self: end;
    margin-top: 8px;
  }

  /* Tapped here, so the count of sources is as tall as the pencil and the
     bin beside it, as on the history's rows on a phone. It is the tools'
     only button with a label. */
  .board-card > :slotted(*) .v-btn:not(.v-btn--icon) {
    --v-btn-height: 40px;
  }
}
</style>

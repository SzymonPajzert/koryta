<template>
  <div
    :id="rowId"
    class="arow"
    :class="[
      `arow--tone-${tone}`,
      {
        'arow--open': expanded,
        'arow--dimmed': dimmed,
        'arow--target': highlighted,
      },
    ]"
  >
    <div class="arow__head">
      <!-- One button for the whole line, so a click anywhere on it opens the
           row and a keyboard gets Enter and Space for free. Whatever goes in
           `summary` therefore has to be inert: no links, no buttons - those
           belong in `actions`, beside it, or in the open row. -->
      <button
        type="button"
        class="arow__toggle"
        :aria-expanded="expanded"
        :aria-controls="panelId"
        :aria-label="label"
        data-row-toggle
        @click="expanded = !expanded"
      >
        <v-icon class="arow__chevron" :icon="mdiChevronRight" size="small" />
        <slot name="summary" />
      </button>
      <div v-if="$slots.actions" class="arow__actions">
        <slot name="actions" />
      </div>
    </div>

    <v-expand-transition>
      <!-- Rendered only while open: a list of a hundred rows should not carry
           a hundred selects and textareas, and "is it open" is then also "is
           it in the DOM". -->
      <div v-if="expanded" :id="panelId" class="arow__panel" data-row-panel>
        <div v-if="$slots.meta" class="arow__meta">
          <slot name="meta" />
        </div>
        <div class="arow__main">
          <div class="arow__body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="arow__footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
/** One line of an admin list that opens in place.
 *
 * The one-line rows of the "Ułóż kolejkę" mode on /admin/opinie turned out to
 * be the easiest way to read a long list, and every list that has to be
 * worked through - reports, proposals, an entry's history - now uses them: a
 * line to tell entries apart, and everything else one click away instead of on
 * a card that makes the list ten screens long.
 *
 * Slots:
 * - `summary` - the line itself, inside the toggle button, so inert content
 *   only. The `arow-*` helper classes below lay it out.
 * - `actions` - buttons at the end of the line that work without opening it.
 * - `meta` - who, when, what state: `AdminRowFact`s, in a strip across the
 *   top of the open row.
 * - default - the body of the open row.
 * - `footer` - the decisions available on it.
 */
import { computed, useId } from "vue";
import { mdiChevronRight } from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";

withDefaults(
  defineProps<{
    /** Goes on the root, which is what an anchor such as `#fb-<id>` finds. */
    rowId?: string;
    tone?: RowTone;
    /** Settled and kept for the record: greyed until hovered or focused. */
    dimmed?: boolean;
    /** The row a link points at. Stays marked for as long as it does. */
    highlighted?: boolean;
    /** Accessible name for the toggle, when the summary alone is too terse
     * to be one (an icon and a date, say). */
    label?: string;
  }>(),
  { rowId: undefined, tone: "neutral", label: undefined },
);

const expanded = defineModel<boolean>("expanded", { default: false });

const uid = useId();
const panelId = computed(() => `arow-panel-${uid}`);
</script>

<style>
/* Unscoped on purpose: the summary and meta slots are rendered in the
 * parent's scope, and these are the classes they are laid out with. Every
 * name is `arow`-prefixed so nothing else on the page can match it. */

.arow {
  --arow-ink: var(--v-theme-ink-neutral);
  --arow-surface: var(--v-theme-surface-muted);
  position: relative;
  background: rgb(var(--v-theme-surface));
  /* The rail: every row carries its colour down its left edge. */
  box-shadow: inset 4px 0 0 rgb(var(--arow-ink));
  /* Clears the sticky toolbar when an anchor scrolls a row into view. */
  scroll-margin-top: 96px;
}

.arow--tone-sage {
  --arow-ink: var(--v-theme-ink-sage);
  --arow-surface: var(--v-theme-surface-sage);
}
.arow--tone-success {
  --arow-ink: var(--v-theme-ink-success);
  --arow-surface: var(--v-theme-surface-success);
}
.arow--tone-warning {
  --arow-ink: var(--v-theme-ink-warning);
  --arow-surface: var(--v-theme-surface-warning);
}
.arow--tone-danger {
  --arow-ink: var(--v-theme-ink-danger);
  --arow-surface: var(--v-theme-surface-danger);
}
.arow--tone-info {
  --arow-ink: var(--v-theme-ink-info);
  --arow-surface: var(--v-theme-surface-info);
}
.arow--tone-strong {
  --arow-ink: var(--v-theme-ink-strong);
}

.arow + .arow {
  border-top: 1px solid var(--k-line);
}

.arow__head {
  display: flex;
  align-items: center;
  min-height: 44px;
}

.arow__toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 2px 4px 2px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

/* A line with nothing after it ends a gutter in. The toggle's own 4px assumes
 * a button after it: with the list running edge to edge on a phone, a line's
 * last words sat 5px from the glass. */
.arow__head > .arow__toggle:last-child {
  padding-inline-end: var(--k-gutter);
}

.arow__toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.arow__toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: -2px;
}

.arow__chevron {
  flex: none;
  opacity: 0.6;
  transition: transform 0.15s ease;
}

/* This row's own chevron only: an entry's row holds a history list of rows,
 * which would otherwise all point down while closed. */
.arow--open > .arow__head .arow__chevron {
  transform: rotate(90deg);
}

.arow--open > .arow__head {
  background: rgb(var(--arow-surface));
}

.arow__actions {
  flex: none;
  display: flex;
  align-items: center;
  padding-inline-end: 4px;
}

.arow__panel {
  padding: 12px 16px 16px 40px;
}

.arow__body {
  min-width: 0;
}

.arow__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--k-line);
}

/* Greyed rather than hidden - see opinie's `feedback-settled`. */
.arow--dimmed {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}
.arow--dimmed:hover,
.arow--dimmed:focus-within {
  opacity: 1;
}

/* The row a link points at, tinted as well as ringed: an outline alone is one
 * thin line among the rules between rows, and a list of a hundred has to show
 * which one the link meant at a glance. The ring is an outline rather than a
 * shadow so it is drawn over the open header's tint, and it sits inside the
 * row because the list clips its corners. */
.arow--target {
  background: rgb(var(--v-theme-surface-sage));
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: -2px;
}

/* ---- helpers for the summary line ---- */

/* The part of the line that gives way: one line, ellipsised. It takes what
 * the rest of the line leaves rather than sharing the shortfall with it:
 * sized by its own text, a long title shrank in step with the identifiers
 * beside it, and a 30-character „bez zmian” or an author came out as „bez z…”
 * and „Szymon (l…” while the title kept forty more characters. */
.arow-grow {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A secondary part that also gives way, but only down to a third. */
.arow-side {
  flex: 0 1 auto;
  max-width: 35%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arow-fixed {
  flex: none;
  white-space: nowrap;
}

/* A short word on a pale pill in the same hue: "W trakcie", "Nowy wpis". */
.arow-tag {
  flex: none;
  padding: 0 6px;
  border-radius: var(--k-r-control);
  font-size: var(--k-meta-size);
  line-height: 1.25rem;
  white-space: nowrap;
}

/* ---- facts (AdminRowFact) ---- */

.arow__meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px 24px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--k-line);
}

.afact {
  min-width: 0;
}

/* A label, as type.css has them: 12/600 in the quiet ink, sentence case. It
 * was 11px tracked capitals - under the site's 12px floor, and the one place
 * left where "Autor" read AUTOR. */
.afact__label {
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
}

.afact__value {
  font-size: var(--k-ui-size);
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* ---- phone ---- */

@media (max-width: 599.98px) {
  .arow__panel {
    padding: 12px;
  }

  .arow-side {
    max-width: 45%;
  }

  /* Two facts to a line: at 150px a column, a phone's ~320px fit one, and
   * five facts stacked to ~250px before the row's own content. */
  .arow__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
  }
}
</style>

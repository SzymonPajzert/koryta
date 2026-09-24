<template>
  <div
    :id="rowId"
    class="arow"
    :class="[
      `arow--${variant}`,
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
 * - `meta` - who, when, what state: `AdminRowFact`s. Plain text, icons and
 *   `UserChip` only - variant `c` paints this pane in the row's ink, where a
 *   coloured chip would be unreadable.
 * - default - the body of the open row.
 * - `footer` - the decisions available on it.
 */
import { computed, useId } from "vue";
import { mdiChevronRight } from "@mdi/js";
import { useRowVariant, type RowTone } from "~/composables/rowVariant";

withDefaults(
  defineProps<{
    /** Goes on the root, which is what an anchor such as `#fb-<id>` finds. */
    rowId?: string;
    tone?: RowTone;
    /** Settled and kept for the record: greyed until hovered or focused. */
    dimmed?: boolean;
    /** Where a link just landed. */
    highlighted?: boolean;
    /** Accessible name for the toggle, when the summary alone is too terse
     * to be one (an icon and a date, say). */
    label?: string;
  }>(),
  { rowId: undefined, tone: "neutral", label: undefined },
);

const expanded = defineModel<boolean>("expanded", { default: false });

const variant = useRowVariant();
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

.arow + .arow {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
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
  padding: 2px 4px 2px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
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

.arow__actions {
  flex: none;
  display: flex;
  align-items: center;
  padding-inline-end: 4px;
}

.arow__panel {
  padding: 12px 16px 16px 36px;
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

/* Where a link landed. Inside the row, because the list clips its corners. */
.arow--target {
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: -2px;
}

/* ---- helpers for the summary line ---- */

/* The part of the line that gives way: one line, ellipsised. */
.arow-grow {
  flex: 1 1 auto;
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
  border-radius: 4px;
  font-size: 0.75rem;
  line-height: 1.25rem;
  white-space: nowrap;
}

/* ---- facts (AdminRowFact) ---- */

.arow__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-bottom: 12px;
}

.afact {
  min-width: 0;
}

.afact__label {
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.afact__value {
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

/* ================= a: "karta" ================= */

.arow--a.arow--open > .arow__head {
  font-weight: 500;
}

.arow--a > .arow__panel {
  background: rgb(var(--v-theme-surface-muted));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.arow--a .arow__footer {
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* ================= b: "szyna" ================= */

.arow--b {
  box-shadow: inset 4px 0 0 rgb(var(--arow-ink));
}

.arow--b .arow__toggle {
  padding-inline-start: 12px;
}

.arow--b.arow--open > .arow__head {
  background: rgb(var(--arow-surface));
}

.arow--b > .arow__panel {
  padding-inline-start: 40px;
}

.arow--b .arow__meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.arow--b .afact__value {
  font-weight: 500;
}

.arow--b .arow__footer {
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* ================= c: "podział" ================= */

.arow--c.arow--open > .arow__head {
  font-weight: 500;
  box-shadow: inset 0 -3px 0 rgb(var(--arow-ink));
}

.arow--c > .arow__panel {
  display: grid;
  grid-template-columns: minmax(200px, 28%) 1fr;
  padding: 0;
}

.arow--c > .arow__panel > .arow__meta {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 14px;
  margin: 0;
  padding: 16px 20px;
  background: rgb(var(--arow-ink));
  color: #fff;
}

.arow--c .arow__meta .afact__label {
  color: rgba(255, 255, 255, 0.78);
}

.arow--c .arow__meta .afact__value {
  font-size: 1rem;
  font-weight: 500;
}

.arow--c > .arow__panel > .arow__main {
  padding: 16px 20px;
  min-width: 0;
}

/* Without facts the body takes the whole width. */
.arow--c > .arow__panel > .arow__main:only-child {
  grid-column: 1 / -1;
  padding-inline-start: 36px;
}

.arow--c .arow__footer {
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* ================= phone ================= */

@media (max-width: 599.98px) {
  .arow__panel,
  .arow--b > .arow__panel {
    padding: 12px;
  }

  .arow--c > .arow__panel {
    grid-template-columns: 1fr;
    padding: 0;
  }

  .arow--c > .arow__panel > .arow__meta {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px 20px;
    padding: 12px;
  }

  .arow--c > .arow__panel > .arow__main,
  .arow--c > .arow__panel > .arow__main:only-child {
    padding: 12px;
  }

  .arow-side {
    max-width: 45%;
  }
}
</style>

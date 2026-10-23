<template>
  <!-- Wrapping rather than sliding: a sideways-scrolling row on a phone cut
       the last chip in half with nothing to say more were there. Real
       buttons, so a keyboard and a screen reader get one, with `aria-pressed`
       saying which is on. -->
  <v-chip-group
    v-model="model"
    mandatory
    column
    selected-class="filter-chip--on"
    class="py-0"
  >
    <v-chip
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      tag="button"
      type="button"
      variant="outlined"
      class="filter-chip"
      :aria-pressed="model === option.value"
      :data-filter="option.value"
    >
      {{ option.title }}
      <span
        v-if="option.count !== undefined"
        class="filter-chip__count ms-2"
        :class="
          option.tone === 'danger' && option.count > 0
            ? 'bg-surface-danger text-ink-danger'
            : 'bg-surface-muted text-ink-neutral'
        "
      >
        {{ option.count }}
      </span>
    </v-chip>
  </v-chip-group>
</template>

<script setup lang="ts" generic="T extends string">
/** One of a few views of a list, picked from a row of chips - "Wszystkie ·
 * Zgłoszenia · Z QA" on /admin/opinie, "Do sprawdzenia · Problemy ·
 * Wszystkie" on /qa, the kinds of line on /aktywnosc. Exactly one is always
 * on.
 *
 * A count beside a name says how much is behind it. `danger` paints a count
 * above zero in the danger pair, for the one view that means something is
 * wrong. */
type FilterChipOption = {
  value: T;
  title: string;
  count?: number;
  tone?: "danger";
};

defineProps<{ options: FilterChipOption[] }>();

const model = defineModel<T>({ required: true });
</script>

<style>
/* Quiet until picked: a row of outlined capitals was the loudest thing on the
   page, louder than the lines it filters. Picked, a chip takes the header's
   sage with the ink that reads on it, so the one that is on is also the one
   that stands out.

   Not scoped, because /aktywnosc's own toggles under its row of kinds wear
   the same look: they switch a filter on and off rather than pick one of a
   few views, so that page draws them itself, with this class. One class
   above Vuetify's `.v-chip--variant-outlined`, whose stylesheet can load
   after this one. */
.v-chip.filter-chip {
  border-color: var(--k-line);
  color: rgb(var(--v-theme-ink-neutral));
}

.v-chip.filter-chip--on {
  background: rgb(var(--v-theme-primary));
  border-color: transparent;
  color: rgb(var(--v-theme-ink-strong));
  font-weight: 500;
}

.filter-chip__count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: var(--k-r-pill);
  font-size: var(--k-meta-size);
  line-height: 1.25rem;
  text-align: center;
}
</style>

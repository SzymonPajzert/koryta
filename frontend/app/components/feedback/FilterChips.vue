<template>
  <!-- Wrapping rather than sliding, as on /aktywnosc: a sideways-scrolling row
       on a phone cut the last chip in half with nothing to say more were
       there. Real buttons, so a keyboard and a screen reader get one, with
       `aria-pressed` saying which is on. -->
  <v-chip-group
    v-model="model"
    mandatory
    column
    selected-class="fchip--on"
    class="py-0"
  >
    <v-chip
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      tag="button"
      type="button"
      variant="outlined"
      class="fchip"
      :aria-pressed="model === option.value"
      :data-filter="option.value"
    >
      {{ option.title }}
      <span
        v-if="option.count !== undefined"
        class="fchip__count ms-2"
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
 * Wszystkie" on /qa. Exactly one is always on.
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

<style scoped>
/* Quiet until picked, the way /aktywnosc draws its kinds: picked, a chip
   takes the header's sage with the ink that reads on it. */
.fchip {
  border-color: rgba(var(--v-border-color), 0.24);
  color: rgb(var(--v-theme-ink-neutral));
}

.fchip--on {
  background: rgb(var(--v-theme-primary));
  border-color: transparent;
  color: rgb(var(--v-theme-ink-strong));
  font-weight: 500;
}

.fchip__count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 99px;
  font-size: 0.75rem;
  line-height: 1.25rem;
  text-align: center;
}
</style>

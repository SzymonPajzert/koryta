<template>
  <div class="dreasons">
    <section
      v-for="group in groups"
      :key="group.key"
      class="dreasons__group"
      :data-reasons="group.key"
    >
      <h3 class="dreasons__title">
        {{ group.title }}
        <span class="dreasons__total">{{ formatCount(group.total) }}</span>
      </h3>
      <p v-if="!group.rows.length" class="dreasons__empty">{{ group.empty }}</p>
      <ul v-else class="dreasons__list">
        <li
          v-for="row in group.rows"
          :key="row.reason"
          class="dreasons__row"
          :data-reason="row.reason"
        >
          <span class="dreasons__label" :title="row.reason">
            {{ declarationReasonLabel(row.reason) }}
          </span>
          <span class="dreasons__count">{{ formatCount(row.count) }}</span>
          <!-- A bar against the group's biggest reason, which is what the
               eye compares; the count beside it is the number. -->
          <span class="dreasons__bar" aria-hidden="true">
            <span
              class="dreasons__fill bg-ink-neutral"
              :style="{ width: `${(row.count / group.max) * 100}%` }"
            />
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCount } from "~/utils/chartTheme";
import { declarationReasonLabel } from "~/utils/declarationsAdmin";

/** Why the run stopped short, in two halves: candidacies for which no
 * declaration was found, and declarations from which no date could be cut.
 * Biggest first, since the biggest reason is the one worth fixing in the job.
 * A code nobody has named yet is shown as the code. */
const props = defineProps<{
  notFound: { reason: string; count: number }[];
  failed: { reason: string; count: number }[];
}>();

const reasonGroup = (
  key: string,
  title: string,
  empty: string,
  rows: { reason: string; count: number }[],
) => {
  const sorted = [...rows]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    key,
    title,
    empty,
    rows: sorted,
    total: sorted.reduce((sum, row) => sum + row.count, 0),
    max: Math.max(1, ...sorted.map((row) => row.count)),
  };
};

const groups = computed(() => [
  reasonGroup(
    "candidacies",
    "Kandydatury bez oświadczenia",
    "Przy każdej szukanej kandydaturze coś się znalazło.",
    props.notFound,
  ),
  reasonGroup(
    "extracts",
    "Oświadczenia bez wycinka",
    "Z każdego oświadczenia udało się wyciąć datę.",
    props.failed,
  ),
]);
</script>

<style scoped>
.dreasons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px 40px;
}

.dreasons__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 0.875rem;
  font-weight: 600;
}

.dreasons__total {
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.dreasons__empty {
  margin: 0;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.dreasons__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Label and count on one line, the bar under them across both: the labels
 * run long („nie znaleziono działu z oświadczeniami”) and a bar squeezed
 * beside them would have no length left to compare. */
.dreasons__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
  padding: 6px 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-size: 0.875rem;
}

.dreasons__count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.dreasons__bar {
  grid-column: 1 / -1;
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  background: rgb(var(--v-theme-surface-muted));
  overflow: hidden;
}

.dreasons__fill {
  display: block;
  height: 100%;
}

@media (max-width: 767.98px) {
  .dreasons {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<template>
  <!-- MOCK: `?wariant=` picks one of three shapes for the board round
       election-result-r1; the one Szymon picks stays and the switch goes. -->
  <div
    v-if="variant === 'a'"
    class="election-result"
    :data-testid="testId"
    role="group"
    :aria-label="label"
  >
    <div class="election-result__label text-caption text-medium-emphasis">
      {{ label }}
    </div>
    <!-- Drawn as the result toggle in /eksploruj/tabela's filters, which
         Szymon approved on the board (election-filter-r2). -->
    <v-btn-toggle
      :model-value="key"
      mandatory
      divided
      variant="outlined"
      density="compact"
      color="ink-sage"
      @update:model-value="pick"
    >
      <v-btn
        v-for="option in RESULT_OPTIONS"
        :key="option.key"
        :value="option.key"
        size="small"
        class="text-none"
        :data-testid="`${testId}-${option.key}`"
      >
        {{ option.title }}
      </v-btn>
    </v-btn-toggle>
  </div>
  <v-radio-group
    v-else-if="variant === 'b'"
    :model-value="key"
    :label="label"
    inline
    density="compact"
    hide-details
    :data-testid="testId"
    @update:model-value="pick"
  >
    <v-radio
      v-for="option in RESULT_OPTIONS"
      :key="option.key"
      :label="option.title"
      :value="option.key"
      :data-testid="`${testId}-${option.key}`"
    />
  </v-radio-group>
  <v-select
    v-else
    :model-value="key"
    :items="RESULT_OPTIONS"
    item-title="title"
    item-value="key"
    :label="label"
    density="compact"
    hide-details
    :data-testid="testId"
    @update:model-value="pick"
  />
</template>

<script setup lang="ts">
/** Whether a candidacy won its mandate, in the three states the site stores:
 * won (`true`), lost (`false`), and not known (no value at all).
 *
 * A checkbox could only say two of them. Unticked, it read as "nobody said"
 * until 2026-10-27 and stored nothing; since the site stores PKW's losses
 * (`elected` in shared/api.ts), "lost" has to be something a contributor can
 * pick, and "not known" something they can go back to. Shared by both edit
 * forms - the relation dialogs' `RelationDetailFields` and `EditEdge` - so
 * the three words cannot drift between them.
 */
import { computed } from "vue";
import { useRoute } from "vue-router";

withDefaults(
  defineProps<{
    /** What the form's tests and the e2e suite find it by. */
    testId: string;
    label?: string;
  }>(),
  { label: "Uzyskano mandat" },
);

/** `null` is "not known", and so is a field the form never set. */
const elected = defineModel<boolean | null | undefined>({ required: true });

type ResultKey = "tak" | "nie" | "nie-wiadomo";

const RESULT_OPTIONS: {
  key: ResultKey;
  title: string;
  value: boolean | null;
}[] = [
  { key: "tak", title: "Tak", value: true },
  { key: "nie", title: "Nie", value: false },
  { key: "nie-wiadomo", title: "Nie wiadomo", value: null },
];

const key = computed<ResultKey>(() =>
  elected.value === true
    ? "tak"
    : elected.value === false
      ? "nie"
      : "nie-wiadomo",
);

function pick(value: unknown) {
  const option = RESULT_OPTIONS.find((each) => each.key === value);
  if (option) elected.value = option.value;
}

// MOCK, see the template.
const route = useRoute();
const variant = computed(() => {
  const wanted = route.query.wariant;
  return wanted === "b" || wanted === "c" ? wanted : "a";
});
</script>

<style scoped>
.election-result {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>

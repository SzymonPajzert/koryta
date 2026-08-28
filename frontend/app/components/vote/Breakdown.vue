<template>
  <!-- Nothing behind the number: render it as it always was, so a column of
       mostly-unscored people does not fill up with buttons that open an empty
       card. -->
  <span v-if="!hasDetail" class="vote-breakdown-plain">{{ total }}</span>

  <v-menu
    v-else
    :close-on-content-click="false"
    location="bottom"
    open-on-click
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        class="vote-breakdown-total"
        variant="text"
        size="small"
        density="comfortable"
        :aria-label="`Wynik ${total}. Zobacz, skąd się wziął`"
        @click.stop
      >
        {{ total }}
        <v-icon :icon="mdiChevronDown" size="x-small" class="ml-1" />
      </v-btn>
    </template>

    <v-card min-width="280" max-width="360" class="vote-breakdown-card">
      <v-card-title class="text-subtitle-2 pb-1">Skąd ten wynik</v-card-title>

      <v-card-text class="pt-0">
        <!-- The models first, because on most people they are the whole
             number: 531 nodes in the graph carry a human vote and rather more
             than that carry a model's. -->
        <div class="text-body-2 font-weight-medium mb-1">
          {{ modelSummary }}
        </div>
        <v-list v-if="modelEntries.length" density="compact" class="py-0">
          <v-list-item
            v-for="entry in modelEntries"
            :key="entry.uid"
            class="px-0 vote-breakdown-model"
          >
            <template #prepend>
              <v-chip size="x-small" class="mr-2" variant="tonal">
                {{ entry.score }}
              </v-chip>
            </template>
            <v-list-item-title class="text-body-2">
              {{ entry.label }}
            </v-list-item-title>
            <v-list-item-subtitle v-if="entry.meaning" class="text-caption">
              {{ entry.meaning }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <!-- Only the best model counts towards the total, so a breakdown that
             listed six models next to a total of 4 would look like an
             arithmetic error unless it said so. -->
        <div
          v-if="modelEntries.length > 1"
          class="text-caption text-medium-emphasis mt-1"
        >
          Do wyniku liczy się tylko najwyższa ocena modelu ({{ modelBest }}).
        </div>

        <v-divider class="my-2" />

        <div class="text-body-2 font-weight-medium">{{ humanSummary }}</div>
        <div
          v-if="hasHumanVotes && humanTotal !== 0"
          class="text-caption text-medium-emphasis"
        >
          Ich głosy sumują się do {{ humanTotal > 0 ? "+" : ""
          }}{{ humanTotal }}.
        </div>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
/**
 * What is behind a person's total score.
 *
 * The total on its own is ambiguous in a way that matters to somebody deciding
 * where to spend the next click: `computeVoteStats` sums human verdicts and
 * takes the *best* of the models, so a 4 is four models agreeing, or one
 * reader insisting, or a bit of both, and the column cannot tell them apart.
 * In prod today a node carries between one and six model votes and almost
 * never more than one human one, so most of the number is machine opinion -
 * which is exactly the thing a reader would want to discount.
 *
 * It reads everything off the aggregate the row was already rendered from, so
 * opening one costs no query. That is deliberate: this sits in a table cell,
 * and a component that fetched anything would fetch it once per visible row.
 */
import { computed } from "vue";
import { mdiChevronDown } from "@mdi/js";
import { scoreModelLabel, voteLevelLabel } from "~/composables/votes";
import type { NodeStats } from "~~/shared/model";

const { votes } = defineProps<{
  /** The node's `stats.votes` aggregate, exactly as stored. */
  votes?: NodeStats["votes"];
}>();

const total = computed(() => votes?.interesting ?? 0);

const modelEntries = computed(() =>
  Object.entries(votes?.models ?? {})
    .map(([uid, score]) => ({
      uid,
      score,
      label: scoreModelLabel(uid),
      meaning: voteLevelLabel("interesting", score),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "pl")),
);

/** The best score any model gave, which is the whole of what they contribute.
 *
 * Seeded from the first entry rather than from 0, because `computeVoteStats`
 * adds whatever the maximum is - and a maximum of 0 is not the same claim as
 * no model at all. `banded_scores` only ever emits 1-5 today, so this is
 * defensive; it costs nothing and stops the human total below from absorbing a
 * negative model score as if a reader had cast it.
 */
const modelBest = computed(() =>
  modelEntries.value.length === 0
    ? 0
    : Math.max(...modelEntries.value.map((entry) => entry.score)),
);

const humanCount = computed(() => votes?.humanCount ?? 0);

/** Whether anybody at all has voted, by either field that can say so. */
const hasHumanVotes = computed(
  () => humanCount.value > 0 || !!votes?.humanVoted,
);

/** What the people who voted said, taken together.
 *
 * Derived rather than stored: the total is the human sum plus the best model,
 * so subtracting the one gives the other. Storing it as well would be a second
 * number that could disagree with the first.
 *
 * Only meaningful when somebody actually voted. A node carrying `models` but no
 * `interesting` - which an interrupted aggregate write would leave - subtracts
 * to a negative that no reader ever cast, so the template gates on
 * `hasHumanVotes` rather than on this being non-zero.
 */
const humanTotal = computed(() => total.value - modelBest.value);

const modelSummary = computed(() => {
  const n = modelEntries.value.length;
  if (n === 0) return "Żaden model nie ocenił tej osoby";
  if (n === 1) return "Oceniona przez 1 model";
  return `Oceniona przez ${n} ${plural(n, "modele", "modeli")}`;
});

const humanSummary = computed(() => {
  const n = humanCount.value;
  // `humanCount` is absent on every node whose aggregate predates it, so a 0
  // here means "not recorded" as often as it means "nobody". `humanVoted` is
  // the older field and was always written, so it is what decides the sentence.
  if (n === 0) {
    return votes?.humanVoted ? "Głosowali ludzie" : "Nikt jeszcze nie głosował";
  }
  if (n === 1) return "Zagłosowała 1 osoba";
  return `Zagłosowały ${n} ${plural(n, "osoby", "osób")}`;
});

/** Polish plurals: 2-4 take one form, 5+ another, and the teens follow 5+. */
function plural(n: number, few: string, many: string): string {
  const last = n % 10;
  const lastTwo = n % 100;
  const isFew = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return isFew ? few : many;
}

const hasDetail = computed(
  () => modelEntries.value.length > 0 || hasHumanVotes.value,
);
</script>

<style scoped>
.vote-breakdown-total {
  min-width: 0;
  padding-inline: 6px;
}

.vote-breakdown-model :deep(.v-list-item__prepend) {
  align-self: center;
}
</style>

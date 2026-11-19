<template>
  <v-card variant="outlined">
    <v-card-item>
      <template #prepend>
        <v-icon :icon="mdiTrophyOutline" color="primary" />
      </template>
      <v-card-title class="text-subtitle-1 font-weight-medium">
        Najaktywniejsi
      </v-card-title>
      <v-card-subtitle class="text-wrap">{{ subtitle }}</v-card-subtitle>
    </v-card-item>

    <!-- Who changed the data and who read crops, each ranked by their own
         count: in one ranking the readers filled the top 25 (decision on
         2026-11-19). -->
    <v-tabs
      v-model="tab"
      color="ink-sage"
      density="compact"
      class="contributors__tabs"
      data-testid="contributors-tabs"
    >
      <v-tab
        v-for="name in rankingNames"
        :key="name"
        :value="name"
        :data-testid="`contributors-tab-${name}`"
      >
        {{ TAB_LABELS[name] }}
      </v-tab>
    </v-tabs>

    <v-card-text :class="{ 'contributors--stale': loading }">
      <v-alert
        v-if="rows.length === 0"
        type="info"
        variant="tonal"
        density="compact"
        :text="EMPTY[tab]"
      />

      <div v-else class="contributors__scroll">
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left">#</th>
              <th class="text-left">Użytkownik</th>
              <!-- A ranking of one kind has no mix to name: its bar is only
                   the count against the top one's. -->
              <th class="text-left" style="min-width: 140px">
                {{ mixed ? "Rozkład" : "" }}
              </th>
              <th
                v-for="kind in columnKinds"
                :key="kind"
                class="text-right d-none d-md-table-cell"
              >
                <v-tooltip :text="activityKindDescriptions[kind]">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-inline-flex align-center ga-1">
                      <span
                        class="contributors__dot"
                        :style="{ backgroundColor: activityColors[kind] }"
                      />
                      {{ activityKindLabels[kind] }}
                    </span>
                  </template>
                </v-tooltip>
              </th>
              <th class="text-right">
                {{ mixed ? "Razem" : TAB_LABELS[tab] }}
              </th>
              <th class="text-right">Ostatnio</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in rows"
              :key="row.key"
              :class="{ 'contributors__row--self': row.isSelf }"
            >
              <td class="text-medium-emphasis stats-numeric">
                {{ index + 1 }}
              </td>
              <td>
                <!-- Only an admin holds a uid, and only a uid opens the review
                     queue filtered to one person. -->
                <NuxtLink
                  v-if="identified && row.uid"
                  :to="proposalsTo(row.uid)"
                  class="contributors__link"
                  title="Zobacz, co ta osoba zaproponowała"
                >
                  <UserChip :uid="row.uid" :user="chipUser(row)" />
                </NuxtLink>
                <StatsContributorName v-else :row="row" />
              </td>
              <td>
                <div
                  class="contributors__mix"
                  role="img"
                  :aria-label="mixLabel(row)"
                  :style="{ width: mixWidth(row) }"
                >
                  <span
                    v-for="kind in shownKinds"
                    v-show="row.counts[kind] > 0"
                    :key="kind"
                    class="contributors__mix-part"
                    :style="{
                      width: (row.counts[kind] / row.total) * 100 + '%',
                      backgroundColor: activityColors[kind],
                    }"
                  />
                </div>
              </td>
              <td
                v-for="kind in columnKinds"
                :key="kind"
                class="text-right stats-numeric d-none d-md-table-cell"
                :class="{ 'text-disabled': row.counts[kind] === 0 }"
              >
                <NuxtLink
                  v-if="
                    identified &&
                    kind === 'revision' &&
                    row.uid &&
                    row.counts.revision > 0
                  "
                  :to="proposalsTo(row.uid)"
                  class="contributors__link"
                  title="Zobacz, co ta osoba zaproponowała"
                >
                  {{ row.counts[kind] }}
                </NuxtLink>
                <template v-else>{{ row.counts[kind] }}</template>
              </td>
              <td class="text-right font-weight-medium stats-numeric">
                {{ row.total }}
              </td>
              <td class="text-right text-medium-emphasis text-no-wrap">
                {{ formatDaysAgo(row.lastActiveAt) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <!-- Both of these read off who is signed in, which the server does not
           know, so they are client-only rather than server-rendered wrong and
           corrected a tick later. -->
      <ClientOnly>
        <!-- Where the reader stands, when the table itself cannot say so
             because their row is past the slice it shows. -->
        <div
          v-if="selfBelowTheFold"
          class="text-body-2 text-medium-emphasis mt-3"
        >
          Twoje miejsce:
          <strong class="text-high-emphasis">{{ self!.rank }}</strong>
          z {{ count }}, {{ selfTotalLabel }} w tym okresie.
        </div>

        <!-- The invitation, and the only place the setting is explained to
             somebody who has not gone looking for it. Not shown to an admin:
             they see every name already, so it would be advice about a page
             they are not on - and not shown while the response is in flight
             either, since `identified` is false until it lands and an admin
             would otherwise be told to sign in for a moment. -->
        <v-alert
          v-if="!identified && !loading"
          :type="callToAction.type"
          variant="tonal"
          density="compact"
          class="mt-4"
        >
          <div class="d-flex flex-wrap align-center ga-3">
            <span class="flex-grow-1">{{ callToAction.text }}</span>
            <v-btn
              v-if="callToAction.to"
              :to="callToAction.to"
              size="small"
              variant="tonal"
              :append-icon="mdiArrowRight"
            >
              {{ callToAction.action }}
            </v-btn>
          </div>
        </v-alert>
      </ClientOnly>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiTrophyOutline, mdiArrowRight } from "@mdi/js";
import {
  activityKindLabels,
  activityKindDescriptions,
  rankingKinds,
  rankingNames,
  type RankingName,
} from "~~/shared/activity";
import type {
  ActivityContributor,
  ActivityRanking,
} from "~~/server/api/stats/activity.get";
import { activityColors, formatDaysAgo } from "~/utils/chartTheme";
import { polishCounting } from "~/composables/polish";

/** Who moved the data in the selected window, ranked.
 *
 * The ranking is public and the names in it are not. `/api/stats/activity`
 * decides that per row before it sends anything - a row the caller may not put
 * a name to arrives already masked, with no uid, address or avatar attached -
 * so this component renders `row.name` and never has to know whose it is. That
 * is the point: there is nothing here to leak, whatever the markup does.
 *
 * An admin still sees the whole identity, and their rows still link into the
 * review queue, because the uid arrives only for them.
 *
 * The per-row bar shows the mix of what a person changed, in the same colours
 * the timeline uses, and its width scales with their total — so the ranking is
 * readable at a glance while the numbers stay in the columns beside it.
 * Readings are one kind, ranked on their own tab, where the bar is the count
 * alone.
 */
const props = defineProps<{
  /** One per tab; null until the response lands. */
  rankings: Record<RankingName, ActivityRanking> | null;
  identified: boolean;
  windowDays: number;
  /** Whether anybody is signed in, which decides what the invitation offers. */
  signedIn?: boolean;
  /** Whether the reader has already turned their own name on. */
  profilePublic?: boolean;
  loading?: boolean;
}>();

const TAB_LABELS: Record<RankingName, string> = {
  changes: "Zmiany",
  readings: "Skany",
};

const EMPTY: Record<RankingName, string> = {
  changes: "W tym okresie nikt nie zmieniał danych.",
  readings: "W tym okresie nikt nic nie odczytał.",
};

/** What the reader's own total is a count of, by its three Polish forms. */
const TOTAL_NOUNS: Record<RankingName, [string, string, string]> = {
  changes: ["zmiana", "zmiany", "zmian"],
  readings: ["skan", "skany", "skanów"],
};

/** The scans open first, for now (decision on 2026-11-19). */
const tab = ref<RankingName>("readings");

const ranking = computed(() => props.rankings?.[tab.value] ?? null);
const rows = computed(() => ranking.value?.rows ?? []);
const count = computed(() => ranking.value?.count ?? 0);
const self = computed(() => ranking.value?.self ?? null);

const shownKinds = computed(() => rankingKinds[tab.value]);
/** Whether the tab ranks several kinds, which then each get a column, a part
 * of the bar and a „Razem”. */
const mixed = computed(() => shownKinds.value.length > 1);
/** A column per kind only beside a „Razem” they add up to. */
const columnKinds = computed(() => (mixed.value ? shownKinds.value : []));

const subtitle = computed(() => {
  const window =
    props.windowDays === 1 ? "Dzisiaj" : `Ostatnie ${props.windowDays} dni`;
  return `${window} · ${polishCounting(
    count.value,
    "osoba",
    "osoby",
    "osób",
  )} przy pracy`;
});

const topTotal = computed(() =>
  Math.max(1, ...rows.value.map((row) => row.total)),
);

const mixWidth = (row: ActivityContributor) =>
  `${Math.max(6, (row.total / topTotal.value) * 100)}%`;

const chipUser = (row: ActivityContributor) => ({
  displayName: row.name,
  email: row.email,
  photoURL: row.photoURL,
});

/** The review queue narrowed to one person, with both filters off: the
 * per-author path sees their whole history, including the older revisions that
 * carry no `update_automatic` flag and so never show up in the aggregate list.
 * The queue is the first section of /admin/rewizje; the hash scrolls to it. */
const proposalsTo = (uid: string) =>
  `/admin/rewizje?author=${encodeURIComponent(uid)}&status=all&automatic=all#kolejka`;

const mixLabel = (row: ActivityContributor) =>
  shownKinds.value
    .filter((kind) => row.counts[kind] > 0)
    .map((kind) => `${activityKindLabels[kind]}: ${row.counts[kind]}`)
    .join(", ");

const selfBelowTheFold = computed(
  () => !!self.value && !rows.value.some((row) => row.isSelf),
);

const selfTotalLabel = computed(() =>
  polishCounting(self.value?.total ?? 0, ...TOTAL_NOUNS[tab.value]),
);

const callToAction = computed(() => {
  if (!props.signedIn) {
    return {
      type: "info" as const,
      text: "Zaloguj się, żeby zobaczyć swoje miejsce w rankingu — i zdecydować, czy Twoja nazwa ma być w nim widoczna.",
      action: "Zaloguj się",
      to: "/login",
    };
  }
  if (props.profilePublic) {
    return {
      type: "success" as const,
      text: "Twoja nazwa jest tu widoczna dla wszystkich. Możesz ją schować z powrotem w ustawieniach profilu.",
      action: "Ustawienia",
      to: "/profil",
    };
  }
  return {
    type: "info" as const,
    text: "Dla innych Twoja nazwa jest tu zamazana. Jeśli chcesz, żeby było widać, kto to zrobił — włącz to w swoim profilu.",
    action: "Pokaż moją nazwę",
    to: "/profil",
  };
});
</script>

<style scoped>
.contributors--stale {
  opacity: 0.45;
  transition: opacity 150ms ease;
}

.contributors__scroll {
  overflow-x: auto;
}

/* In line with the card's title, over a hairline that the table starts
   under. */
.contributors__tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 0 8px;
}

/* The reader's own row. A tint rather than a border: the row keeps its height,
   so the ranking does not jump when the response with the reader in it lands. */
.contributors__row--self > td {
  background-color: rgba(var(--v-theme-primary), 0.07);
}

.contributors__mix {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  min-width: 8px;
}

/* The 2px gap in the surface colour, not a border, is what separates fills. */
.contributors__mix-part:not(:last-child) {
  margin-right: 2px;
}

.contributors__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stats-numeric {
  font-variant-numeric: tabular-nums;
}

/* A ranking table, not a nav: the links take the colour of the cell they sit in
   and only underline once pointed at. */
.contributors__link {
  color: inherit;
  text-decoration: none;
}

.contributors__link:hover,
.contributors__link:focus-visible {
  text-decoration: underline;
}
</style>

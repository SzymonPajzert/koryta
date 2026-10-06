<template>
  <div class="w-100">
    <h1 class="text-h5 text-sm-h4 mb-2">Procesy</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Wszystko, co zmienia dane - pobieranie KRS, lustro, kopia bazy, crawl,
      importy na stronę i zapisy z rozszerzenia - i jak daleko doszło. Joby
      zgłaszają się same, gdziekolwiek działają; te, które milczą, widać po tym,
      co zostawiły w zasobnikach.
    </p>

    <!-- The focal point: how many jobs need a look, big and in colour, then
         the calmer counts. Everything below is the detail behind it. -->
    <div v-if="overview" class="jobs-summary mb-4" data-jobs-summary>
      <div
        class="jobs-summary__focus"
        :class="`bg-ink-${focusTone}`"
        data-problem-count
        :data-count="problemEntries.length"
      >
        <v-icon
          :icon="problemEntries.length ? mdiAlertOctagon : mdiCheckCircle"
          size="40"
          class="jobs-summary__icon"
        />
        <div class="jobs-summary__focus-text">
          <div class="jobs-summary__headline">
            <span v-if="problemEntries.length" class="jobs-summary__number">
              {{ problemEntries.length }}
            </span>
            <span class="jobs-summary__label">{{ problemLabel }}</span>
          </div>
          <div v-if="problemEntries.length" class="jobs-summary__names">
            <a
              v-for="entry in problemEntries"
              :key="entry.definition.id"
              :href="`#${jobAnchor(entry.definition.id)}`"
            >
              {{ entry.definition.title }}
            </a>
          </div>
        </div>
      </div>

      <div class="jobs-summary__stats">
        <div
          v-for="stat in stats"
          :key="stat.status"
          class="jobs-summary__stat"
          :data-stat="stat.status"
        >
          <span
            class="jobs-summary__stat-number"
            :class="`text-ink-${jobHealthConfig[stat.status].tone}`"
          >
            {{ stat.count }}
          </span>
          <span class="jobs-summary__stat-label">
            {{ jobHealthConfig[stat.status].summary }}
          </span>
        </div>
      </div>

      <div class="jobs-summary__refresh">
        <span
          v-if="lastLoadedAt"
          class="text-caption text-medium-emphasis"
          data-loaded-at
        >
          Odświeżono {{ loadedAtText }}
        </span>
        <v-btn
          variant="outlined"
          size="small"
          :prepend-icon="mdiRefresh"
          :loading="refreshing"
          data-jobs-refresh
          @click="refreshNow"
        >
          Odśwież
        </v-btn>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
    </v-alert>
    <v-alert
      v-for="(problem, index) in overview?.problems ?? []"
      :key="index"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2"
      data-jobs-problem
    >
      {{ problem }}
    </v-alert>
    <v-progress-linear v-if="loading && !overview" indeterminate class="mb-4" />

    <template v-if="overview">
      <section
        v-for="section in sections"
        :key="section.key"
        class="jobs-page__section"
        :data-kind="section.key"
      >
        <AdminSectionHead
          :title="section.title"
          :count="section.rows.length"
          :info="section.info"
        />
        <AdminRowList class="mb-4">
          <JobsRow
            v-for="row in section.rows"
            :key="row.definition.id"
            :definition="row.definition"
            :view="row.view"
            :health="row.health"
            :now="asOf"
            :highlighted="targetId === row.definition.id"
            :show-tasks="isOwner"
            :expanded="openRows.has(row.definition.id)"
            @update:expanded="(open) => setOpen(row.definition.id, open)"
          />
        </AdminRowList>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { mdiAlertOctagon, mdiCheckCircle, mdiRefresh } from "@mdi/js";
import { useAuthState } from "~/composables/auth";
import {
  jobEntries,
  useOpsJobs,
  usePollWhileVisible,
  useTickingNow,
  type JobEntry,
} from "~/composables/opsJobs";
import {
  jobAnchor,
  jobHealthConfig,
  jobKindConfig,
  otherJobsConfig,
  plural,
} from "~/utils/jobStyle";
import {
  isProblem,
  JOB_HEALTH,
  JOB_KINDS,
  jobHealth,
  shortWarsawTime,
  type JobHealth,
  type JobHealthStatus,
} from "~~/shared/jobs";

definePageMeta({
  // The same claim `/api/ops/jobs` asks for, and nothing besides: somebody in
  // the group need not be an administrator. The layout lights the Admin menu
  // on this middleware too, since that is where the page's entry is.
  middleware: "datascience",
  // One column of rows, like the other admin lists.
  maxWidth: 1100,
});

useHead({ title: "Procesy (Admin) - koryta.pl" });

const route = useRoute();
const { isOwner } = useAuthState();

const { overview, loading, error, load, lastLoadedAt } = useOpsJobs();

/** Every 30 s: enough for "Bez sygnału" to appear within a minute of a
 * heartbeat allowance running out, on a page nobody touches. */
const { now, tick } = useTickingNow(30_000);

const refresh = async () => {
  await load();
  tick();
};

/** Once a minute while the tab is in front - the jobs heartbeat about that
 * often, and the server caches its bucket probes for five. Quietly: the
 * button's spinner is for a click. It is redrawn every frame while it shows -
 * a quarter of a CPU core in headless Chromium - and a poll nobody asked for
 * has nothing to tell anyone while it is out; "Odświeżono" says how old the
 * page is once it is back. */
usePollWhileVisible(refresh, 60_000);

/** A refresh asked for with the button, while it is out. */
const refreshing = ref(false);
async function refreshNow() {
  refreshing.value = true;
  try {
    await refresh();
  } finally {
    refreshing.value = false;
  }
}

/** The clock health is judged against. Normally now, so "W toku" turns into
 * "Bez sygnału" on a page nobody touches. But once the data is more than two
 * polls old - a tab left in the background polls nothing, a refresh can fail
 * - ageing it against the wall clock would only invent problems: a crawl
 * heartbeating every minute would read stalled because the page stopped
 * asking. Then it is judged as of when it was read. */
const STALE_DATA_MS = 150_000;
const asOf = computed(() => {
  const loaded = lastLoadedAt.value;
  if (!loaded) return now.value;
  return now.value.getTime() - loaded.getTime() > STALE_DATA_MS
    ? loaded
    : now.value;
});

type Row = JobEntry & { health: JobHealth };

const rows = computed<Row[]>(() =>
  overview.value
    ? jobEntries(overview.value).map((entry) => ({
        ...entry,
        health: jobHealth(entry.definition, entry.view, asOf.value),
      }))
    : [],
);

/** One section per kind, in `JOB_KINDS` order, each in `JOBS` order; then the
 * jobs only their runs know about. An empty kind keeps its heading: a job
 * that should exist and does not is what this page is for. */
const sections = computed(() => [
  ...JOB_KINDS.map((kind) => ({
    key: kind as string,
    title: jobKindConfig[kind].title,
    info: jobKindConfig[kind].info,
    rows: rows.value.filter(
      (row) => !row.other && row.definition.kind === kind,
    ),
  })),
  ...(rows.value.some((row) => row.other)
    ? [
        {
          key: "others",
          title: otherJobsConfig.title,
          info: otherJobsConfig.info,
          rows: rows.value.filter((row) => row.other),
        },
      ]
    : []),
]);

const problemEntries = computed(() =>
  rows.value
    .filter((row) => isProblem(row.health.status))
    .sort(
      (a, b) =>
        JOB_HEALTH.indexOf(a.health.status) -
        JOB_HEALTH.indexOf(b.health.status),
    ),
);

/** The block takes the colour of the worst problem: red for anything broken
 * or silent, amber when the worst is a mirror falling behind, green when
 * there is nothing to look at. */
const focusTone = computed(() => {
  const worst = problemEntries.value[0];
  return worst ? jobHealthConfig[worst.health.status].tone : "success";
});

const problemLabel = computed(() => {
  const count = problemEntries.value.length;
  if (!count) return "Nic nie wymaga uwagi";
  return plural(
    count,
    "proces wymaga uwagi",
    "procesy wymagają uwagi",
    "procesów wymaga uwagi",
  );
});

/** The calmer counts beside the block. The three that say how the rest is
 * doing always show, the ones that only sometimes happen when they do. */
const ALWAYS: JobHealthStatus[] = ["running", "ok", "never"];
const stats = computed(() =>
  JOB_HEALTH.filter((status) => !isProblem(status))
    .map((status) => ({
      status,
      count: rows.value.filter((row) => row.health.status === status).length,
    }))
    .filter((stat) => ALWAYS.includes(stat.status) || stat.count > 0),
);

const loadedAtText = computed(() =>
  lastLoadedAt.value
    ? shortWarsawTime(lastLoadedAt.value.toISOString(), now.value)
    : "",
);

// ---- open rows ----

const openRows = reactive(new Set<string>());
const setOpen = (id: string, open: boolean) =>
  open ? openRows.add(id) : openRows.delete(id);

/** A row that turns into a problem opens itself, once: closing it again is
 * respected until it has been fine in between, so a poll does not keep
 * reopening what the owner has already read. */
const autoOpened = new Set<string>();
watch(
  () => problemEntries.value.map((row) => row.definition.id),
  (ids) => {
    const current = new Set(ids);
    for (const id of current) {
      if (!autoOpened.has(id)) {
        autoOpened.add(id);
        openRows.add(id);
      }
    }
    for (const id of [...autoOpened]) {
      if (!current.has(id)) autoOpened.delete(id);
    }
  },
  { immediate: true },
);

/** The job a `#proces-<id>` link names - the summary's own links included. */
const targetId = computed(() => /^#proces-(.+)$/.exec(route.hash)?.[1] ?? null);

async function focusTarget() {
  const id = targetId.value;
  if (!id || !rows.value.some((row) => row.definition.id === id)) return;
  openRows.add(id);
  await nextTick();
  document
    .getElementById(jobAnchor(id))
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

watch(() => route.hash, focusTarget);

onMounted(async () => {
  await refresh();
  await focusTarget();
});
</script>

<style scoped>
.jobs-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px 24px;
}

.jobs-summary__focus {
  flex: 1 1 320px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-radius: 10px;
}

.jobs-summary__icon {
  flex: none;
}

.jobs-summary__focus-text {
  min-width: 0;
}

.jobs-summary__headline {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 12px;
}

.jobs-summary__number {
  font-size: 3rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.jobs-summary__label {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
}

.jobs-summary__names {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  margin-top: 6px;
  font-size: 0.875rem;
}

/* On the solid block, links keep its text colour: underlined white reads as
 * a link there, the theme's blue would not read at all. */
.jobs-summary__names a {
  color: inherit;
  font-weight: 500;
}

.jobs-summary__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
}

.jobs-summary__stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.jobs-summary__stat-number {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.jobs-summary__stat-label {
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.jobs-summary__refresh {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  margin-inline-start: auto;
}

@media (max-width: 599.98px) {
  .jobs-summary__refresh {
    flex-direction: row;
    align-items: center;
    margin-inline-start: 0;
  }
}
</style>

<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="jobAnchor(definition.id)"
    :tone="style.tone"
    :highlighted="highlighted"
    :data-job="definition.id"
    :data-health="health.status"
  >
    <template #summary>
      <span class="job-head">
        <v-icon
          class="job-head__kind"
          size="small"
          :icon="jobKindConfig[definition.kind].icon"
          :color="`ink-${style.tone}`"
          :title="jobKindConfig[definition.kind].title"
        />
        <span class="job-head__title">{{ definition.title }}</span>
        <span
          class="arow-tag"
          :class="toneClasses(style.tone)"
          data-health-chip
        >
          <v-icon :icon="style.icon" size="12" class="mr-1" />
          {{ style.title }}
        </span>
        <span
          class="job-head__detail text-medium-emphasis"
          :title="health.detail"
          data-health-detail
        >
          {{ health.detail }}
        </span>
        <span class="job-head__side text-body-2">
          <!-- A run going with a count to show: how far, as a bar when it
               knows the total. Inert spans rather than v-progress-linear,
               because the whole line is one button. -->
          <template v-if="liveProgress">
            <span
              v-if="liveShare !== null"
              class="job-bar"
              role="progressbar"
              :aria-valuenow="Math.round(liveShare * 100)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span
                class="job-bar__fill"
                :style="{ width: `${liveShare * 100}%` }"
              />
            </span>
            <span class="job-head__count" data-row-progress>
              {{ progressText(liveProgress, "short") }}
            </span>
          </template>
          <span v-else-if="lastRun" class="job-head__last" data-row-last>
            {{ lastRun }}
          </span>
          <span
            v-if="nextRun"
            class="job-head__next text-medium-emphasis"
            data-row-next
          >
            następne: {{ nextRun }}
          </span>
          <span
            v-else-if="definition.kind === 'scheduled'"
            class="job-head__next text-medium-emphasis"
            data-row-unscheduled
          >
            jeszcze bez harmonogramu
          </span>
        </span>
      </span>
    </template>

    <template #meta>
      <AdminRowFact label="Gdzie">{{ definition.runsOn }}</AdminRowFact>
      <AdminRowFact v-if="scheduleFact" label="Harmonogram">
        {{ scheduleFact }}
      </AdminRowFact>
      <AdminRowFact
        v-if="view.record"
        label="Ostatnio udany"
        data-fact-succeeded
      >
        {{
          view.record.lastSucceededAt
            ? shortWarsawTime(view.record.lastSucceededAt, now)
            : "jeszcze nigdy"
        }}
      </AdminRowFact>
      <!-- The command is a line to paste, so it gets the strip's full width
           instead of being folded into a 150px column. -->
      <AdminRowFact
        v-if="definition.command"
        label="Polecenie"
        class="job-row__wide"
      >
        <code class="job-row__command">{{ definition.command }}</code>
      </AdminRowFact>
    </template>

    <p class="text-body-2 mb-3">{{ definition.summary }}</p>

    <!-- What the silent jobs left behind, read from their buckets. -->
    <template v-if="view.probe">
      <v-alert
        v-if="'error' in view.probe"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        data-probe-error
      >
        Nie udało się sprawdzić zasobnika: {{ view.probe.error }}
      </v-alert>
      <div v-else class="job-row__block" data-probe>
        <h3 class="job-row__subhead">
          {{ jobProbeConfig[view.probe.kind].title }}
        </h3>
        <ul v-if="view.probe.kind === 'compressedMirror'" class="job-row__list">
          <li
            v-for="host in view.probe.hosts"
            :key="host.host"
            :data-mirror-host="host.host"
          >
            <code>{{ host.host }}</code>
            <template v-if="host.through">
              - lustro do <strong>{{ host.through }}</strong>
              <template v-if="host.archivedAt">
                · zarchiwizowane {{ shortWarsawTime(host.archivedAt, now) }}
              </template>
              <template v-if="host.bytes !== null">
                · {{ formatMegabytes(host.bytes) }}
              </template>
              <template v-if="host.newerData">
                · nowsze dane od {{ host.newerData }}
              </template>
              <template v-else-if="host.newerData === null">
                · nic nowszego do spakowania
              </template>
            </template>
            <template v-else> - brak archiwum</template>
          </li>
        </ul>
        <template v-else-if="view.probe.kind === 'firestoreExport'">
          <ul v-if="view.probe.latest" class="job-row__list">
            <li>
              folder <code>{{ view.probe.latest.folder }}</code>
            </li>
            <li>
              start {{ shortWarsawTime(view.probe.latest.startedAt, now) }}
            </li>
            <li>
              <template v-if="view.probe.latest.finishedAt">
                koniec {{ shortWarsawTime(view.probe.latest.finishedAt, now) }}
              </template>
              <template v-else>bez pliku końcowego</template>
            </li>
          </ul>
          <p v-else class="text-body-2">
            Nie znaleziono kopii z ostatnich dwóch dni.
          </p>
        </template>
      </div>
    </template>

    <p
      v-if="captureStatsText"
      class="text-body-2 font-weight-medium mb-3"
      data-capture-stats
    >
      {{ captureStatsText }}
    </p>

    <ul
      v-if="definition.notes?.length"
      class="job-row__list job-row__notes text-body-2 mb-3"
    >
      <li v-for="(note, index) in definition.notes" :key="index">
        {{ note }}
      </li>
    </ul>

    <div
      v-if="definition.tasks?.length"
      class="job-row__tasks text-body-2 mb-3"
      data-job-tasks
    >
      <span class="text-medium-emphasis">Zadania:</span>
      <NuxtLink
        v-for="task in definition.tasks"
        :key="task"
        :to="taskLink(task)"
      >
        <code>{{ task }}</code>
      </NuxtLink>
    </div>

    <h3 class="job-row__subhead">
      {{ definition.kind === "triggered" ? "Ostatnie zapisy" : "Uruchomienia" }}
    </h3>
    <JobsRuns
      v-if="view.runs.length > 0"
      :runs="view.runs"
      :definition="definition"
      :now="now"
    />
    <p v-else class="text-body-2 text-medium-emphasis" data-no-runs>
      {{ emptyText }}
    </p>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  formatMegabytes,
  jobAnchor,
  jobHealthConfig,
  jobKindConfig,
  jobProbeConfig,
  NO_RUNS_YET,
  plural,
  progressShare,
  progressText,
  scheduleText,
  toneClasses,
} from "~/utils/jobStyle";
import { formatCount } from "~/utils/chartTheme";
import {
  formatDuration,
  isFinished,
  nextSlot,
  scheduleIsLive,
  shortWarsawTime,
  taskLink,
  type JobDefinition,
  type JobHealth,
  type JobView,
} from "~~/shared/jobs";

/** One job on /admin/procesy: a line with its health and where its newest
 * run has got, opening in place to what it is, where it runs, how to start
 * it and its runs. */

const props = defineProps<{
  definition: JobDefinition;
  view: JobView;
  health: JobHealth;
  now: Date;
  highlighted?: boolean;
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const style = computed(() => jobHealthConfig[props.health.status]);

const latest = computed(() => props.view.runs[0] ?? null);

/** The newest run's progress, while it is going. The triggered job's runs
 * are pages, which have no progress of their own. */
const liveProgress = computed(() => {
  const run = latest.value;
  return run && !isFinished(run.state) ? run.progress : null;
});
const liveShare = computed(() =>
  liveProgress.value ? progressShare(liveProgress.value) : null,
);

/** When the newest run started and how long it took - or, for the export,
 * which reports nothing, when its newest copy did. */
const lastRun = computed(() => {
  const run = latest.value;
  if (run) {
    const at = shortWarsawTime(run.startedAt, props.now);
    if (props.definition.kind === "triggered") return `ostatni: ${at}`;
    const took = run.finishedAt
      ? formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))
      : `od ${formatDuration(props.now.getTime() - Date.parse(run.startedAt))}`;
    return `${at} · ${took}`;
  }
  const probe = props.view.probe;
  if (probe?.kind === "firestoreExport" && "latest" in probe && probe.latest) {
    const at = shortWarsawTime(probe.latest.startedAt, props.now);
    return probe.latest.finishedAt
      ? `${at} · ${formatDuration(Date.parse(probe.latest.finishedAt) - Date.parse(probe.latest.startedAt))}`
      : at;
  }
  return null;
});

const live = computed(() =>
  scheduleIsLive(props.definition, props.view.record),
);

const nextRun = computed(() =>
  live.value && props.definition.schedule
    ? shortWarsawTime(
        nextSlot(props.definition.schedule, props.now).toISOString(),
        props.now,
      )
    : null,
);

const scheduleFact = computed(() => {
  const text = scheduleText(props.definition);
  if (text) {
    return live.value
      ? text
      : `${text} (jeszcze nie uruchomiony z harmonogramu)`;
  }
  return props.definition.scheduleNote ?? null;
});

/** The week of captures in one line, whatever the newest twenty show. */
const captureStatsText = computed(() => {
  const stats = props.view.captureStats;
  if (!stats) return null;
  const days = Math.max(
    1,
    Math.round((props.now.getTime() - Date.parse(stats.since)) / 86_400_000),
  );
  const count = (n: number, one: string, few: string, many: string) =>
    `${formatCount(n)} ${plural(n, one, few, many)}`;
  const { succeeded, failed, running, queued } = stats.byState;
  return [
    `Ostatnie ${days} ${plural(days, "dzień", "dni", "dni")}: ${count(succeeded, "udany", "udane", "udanych")}`,
    count(failed, "błąd", "błędy", "błędów"),
    `${formatCount(running)} w toku`,
    `${formatCount(queued)} w kolejce`,
  ].join(" · ");
});

/** Why there is nothing to list: a job that reports has not yet, a probe job
 * never will, and nobody has captured anything. */
const emptyText = computed(() => {
  if (props.view.unavailable) {
    return "Nie udało się wczytać uruchomień - powód jest nad listą.";
  }
  const probe = props.definition.probe;
  if (probe) return jobProbeConfig[probe].source;
  if (props.definition.kind === "triggered") {
    return "Nikt jeszcze niczego nie zapisał.";
  }
  return NO_RUNS_YET;
});
</script>

<style scoped>
/* The line: one row on a wide screen, the detail ellipsised; on a narrow
 * one the detail drops to a line of its own instead of being cut to nothing. */
.job-head {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 10px;
  padding: 4px 0;
}

.job-head__kind,
.job-head__title {
  flex: none;
}

.job-head__title {
  font-weight: 600;
}

.job-head__detail {
  order: 10;
  flex: 1 1 100%;
  min-width: 0;
  font-size: 0.8125rem;
}

/* Its parts wrap rather than run off a phone's edge; each part holds
 * together. */
.job-head__side {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  margin-inline-start: auto;
}

.job-head__side > * {
  white-space: nowrap;
}

.job-head__count,
.job-head__last {
  font-variant-numeric: tabular-nums;
}

.job-head__next {
  font-size: 0.8125rem;
}

@media (min-width: 960px) {
  .job-head {
    flex-wrap: nowrap;
  }

  .job-head__detail {
    order: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-head__side {
    flex-wrap: nowrap;
    margin-inline-start: 0;
  }
}

.job-bar {
  display: inline-block;
  width: 96px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-info));
}

.job-bar__fill {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-ink-info));
}

.job-row__wide {
  grid-column: 1 / -1;
}

.job-row__command {
  font-size: 0.8125rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.job-row__block {
  margin-bottom: 12px;
}

.job-row__subhead {
  margin-bottom: 4px;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.job-row__list {
  padding-left: 20px;
  font-size: 0.875rem;
}

/* Folder names and hosts have no spaces to break at. */
.job-row__list code {
  overflow-wrap: anywhere;
}

.job-row__tasks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.job-row__tasks code {
  font-size: 0.8125rem;
}
</style>

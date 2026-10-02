<template>
  <ol class="job-runs" data-job-runs>
    <li
      v-for="run in runs"
      :key="run.id"
      class="job-run"
      :data-run="run.id"
      :data-run-state="run.state"
    >
      <!-- A capture: what was captured, and what came of it. -->
      <template v-if="captures">
        <div class="job-run__line">
          <span class="job-run__start" :title="fullTime(run.startedAt)">
            {{ shortWarsawTime(run.startedAt, now) }}
          </span>
          <a
            v-if="run.url"
            :href="run.url"
            target="_blank"
            rel="noopener"
            class="job-run__title"
            data-run-url
          >
            {{ run.title || run.url }}
          </a>
          <span v-else class="job-run__title">{{ run.title }}</span>
          <span
            class="arow-tag"
            :class="toneClasses(chipOf(run).tone)"
            data-run-chip
          >
            <v-icon :icon="chipOf(run).icon" size="12" class="mr-1" />
            {{ chipOf(run).title }}
          </span>
          <NuxtLink
            v-if="run.link"
            :to="run.link"
            class="job-run__facts"
            data-run-facts
          >
            {{ factsText(run) }}
          </NuxtLink>
          <span v-else-if="run.counters.facts !== undefined">
            {{ factsText(run) }}
          </span>
          <span v-if="run.host" class="text-medium-emphasis">
            {{ run.host }}
          </span>
        </div>
        <p
          v-for="(message, index) in run.errors"
          :key="index"
          class="job-run__error text-ink-danger"
        >
          {{ message }}
        </p>
      </template>

      <!-- A reported run. -->
      <template v-else>
        <div class="job-run__line">
          <span class="job-run__start" :title="fullTime(run.startedAt)">
            {{ shortWarsawTime(run.startedAt, now) }}
          </span>
          <span class="job-run__duration text-medium-emphasis">
            {{ durationText(run) }}
          </span>
          <span
            class="arow-tag"
            :class="toneClasses(chipOf(run).tone)"
            data-run-chip
          >
            <v-icon :icon="chipOf(run).icon" size="12" class="mr-1" />
            {{ chipOf(run).title }}
          </span>
          <span v-if="run.trigger" class="text-medium-emphasis">
            {{ runTriggerConfig[run.trigger].title }}
          </span>
          <code v-if="run.host" class="job-run__host">{{ run.host }}</code>
          <span
            v-if="run.phase && !isFinished(run.state)"
            class="text-medium-emphasis"
          >
            - {{ run.phase }}
          </span>
        </div>

        <div v-if="hasExtras(run)" class="job-run__extras">
          <span v-if="run.progress" data-run-progress>
            {{ progressText(run.progress) }}
          </span>
          <span
            v-for="(value, key) in run.counters"
            :key="key"
            class="job-run__counter"
            data-run-counter
          >
            {{ counterLabel(String(key)) }}:
            <strong>{{ counterValue(String(key), value) }}</strong>
          </span>
          <span v-if="run.stopReason" data-run-stop-reason>
            powód: {{ run.stopReason }}
          </span>
          <!-- 75 on a run that stopped with work left is the jobs' "carry on
               tomorrow", not a crash: only a failed run's code is red. -->
          <span
            v-if="run.exitCode"
            :class="
              run.state === 'failed'
                ? 'text-ink-danger'
                : 'text-medium-emphasis'
            "
            data-run-exit
          >
            kod wyjścia {{ run.exitCode }}
          </span>
          <span v-if="run.version" class="text-medium-emphasis">
            wersja <code>{{ run.version }}</code>
          </span>
        </div>

        <!-- Errors folded: twenty stack-trace-ish lines would bury the
             runs under them. The newest run's open when it failed, since
             that is what the row was opened to read. -->
        <div v-if="run.errors.length > 0" class="job-run__errors">
          <button
            type="button"
            class="job-run__errors-toggle text-ink-danger"
            :aria-expanded="openErrors.has(run.id)"
            data-run-errors-toggle
            @click="toggleErrors(run.id)"
          >
            <v-icon
              :icon="openErrors.has(run.id) ? mdiChevronUp : mdiChevronDown"
              size="small"
            />
            {{ run.errors.length }}
            {{ plural(run.errors.length, "błąd", "błędy", "błędów") }}
          </button>
          <ul v-if="openErrors.has(run.id)" data-run-errors>
            <li v-for="(message, index) in run.errors" :key="index">
              <code>{{ message }}</code>
            </li>
          </ul>
        </div>

        <div v-if="run.summaryPath" class="job-run__path">
          <code data-run-summary-path>{{ run.summaryPath }}</code>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="copied === run.id ? 'Skopiowano' : 'Kopiuj ścieżkę'"
            :title="copied === run.id ? 'Skopiowano' : 'Kopiuj ścieżkę'"
            @click="copyPath(run)"
          >
            <v-icon
              :icon="copied === run.id ? mdiCheck : mdiContentCopy"
              size="small"
            />
          </v-btn>
        </div>
      </template>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  mdiCheck,
  mdiChevronDown,
  mdiChevronUp,
  mdiContentCopy,
} from "@mdi/js";
import {
  counterLabel,
  counterValue,
  plural,
  progressText,
  runChip,
  runTriggerConfig,
  toneClasses,
} from "~/utils/jobStyle";
import { formatCount } from "~/utils/chartTheme";
import {
  formatDuration,
  isFinished,
  shortWarsawTime,
  WARSAW,
  type JobDefinition,
  type JobRun,
} from "~~/shared/jobs";

/** A job's newest runs, newest first, in its open row on /admin/procesy:
 * when each started, how long it took, how it ended and what it counted. The
 * extension's captures are runs too, but what matters about one is the page,
 * so they show that instead of the counters. */

const props = defineProps<{
  runs: JobRun[];
  definition: Pick<
    JobDefinition,
    "heartbeatMinutes" | "queuedMinutes" | "captures"
  >;
  now: Date;
}>();

/** Whether these runs are the captures job's pages. Going by the job rather
 * than by the trigger: an import is one run per request as well, and what
 * matters about it is what it counted. */
const captures = computed(() => Boolean(props.definition.captures));

const chipOf = (run: JobRun) => runChip(run, props.definition, props.now);

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    timeZone: WARSAW,
    dateStyle: "medium",
    timeStyle: "medium",
  });

/** How long it took, or - still going - for how long it has been. */
function durationText(run: JobRun): string {
  const started = Date.parse(run.startedAt);
  if (run.finishedAt) {
    return formatDuration(Date.parse(run.finishedAt) - started);
  }
  const sofar = formatDuration(props.now.getTime() - started);
  return run.state === "queued" ? `czeka od ${sofar}` : `od ${sofar}`;
}

const factsText = (run: JobRun) => {
  const facts = run.counters.facts ?? 0;
  return facts
    ? `${formatCount(facts)} ${plural(facts, "fakt", "fakty", "faktów")}`
    : "bez faktów";
};

const hasExtras = (run: JobRun) =>
  Boolean(
    run.progress ||
    Object.keys(run.counters).length ||
    run.stopReason ||
    run.exitCode ||
    run.version,
  );

const openErrors = reactive(
  new Set<string>(
    props.runs[0]?.state === "failed" && !captures.value
      ? [props.runs[0].id]
      : [],
  ),
);
const toggleErrors = (id: string) =>
  openErrors.has(id) ? openErrors.delete(id) : openErrors.add(id);

/** The run whose path was just copied, for a moment, so the click is seen to
 * work. The path stays selectable by hand where the clipboard is refused. */
const copied = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyPath(run: JobRun) {
  try {
    // Inside the try: on an insecure origin `navigator.clipboard` is
    // undefined, and reading it throws rather than rejects.
    await navigator.clipboard.writeText(run.summaryPath ?? "");
    copied.value = run.id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), 2000);
  } catch {
    // Nothing to fall back to beyond the text itself, which selects whole
    // on a click.
  }
}
</script>

<style scoped>
.job-runs {
  list-style: none;
  padding: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.job-run {
  padding: 8px 12px;
  font-size: 0.875rem;
}

.job-run + .job-run {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.job-run__line,
.job-run__extras {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.job-run__extras {
  margin-top: 4px;
  font-size: 0.8125rem;
}

.job-run__start {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.job-run__title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.job-run__host,
.job-run__path code,
.job-run__errors code {
  font-size: 0.75rem;
}

/* `cloud-run:krs-scrape-free/<execution>` is one unbreakable word. */
.job-run__host {
  min-width: 0;
  overflow-wrap: anywhere;
}

.job-run__counter {
  padding: 0 6px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-muted));
}

.job-run__error {
  margin-top: 4px;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.job-run__errors {
  margin-top: 4px;
}

.job-run__errors-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.job-run__errors ul {
  margin: 4px 0 0;
  padding-left: 20px;
}

/* Errors are tracebacks and urls: wrapped, not scrolled sideways. */
.job-run__errors code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.job-run__path {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

/* One click selects the whole path, for copying by hand. */
.job-run__path code {
  user-select: all;
  overflow-wrap: anywhere;
}
</style>

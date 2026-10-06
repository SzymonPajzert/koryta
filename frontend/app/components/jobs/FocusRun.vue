<template>
  <!-- The anchor a `#przebieg-<id>` link scrolls to: this card, not the run's
       line in its job's row further down. -->
  <section
    :id="runAnchor(runId)"
    class="focus-run mb-4"
    :class="`focus-run--${chip.tone}`"
    data-focus-run
    :data-run="runId"
    :data-run-state="run?.state"
  >
    <header class="focus-run__head">
      <div class="focus-run__heading">
        <div class="focus-run__job text-caption" data-focus-job>
          {{ jobTitle }}
          <template v-if="run?.request?.dryRun"> · tylko liczenie</template>
        </div>
        <h2 class="focus-run__title" data-focus-title>
          <NuxtLink v-if="run?.request && run.link" :to="run.link">
            {{ run.title || run.request.name }}
          </NuxtLink>
          <a
            v-else-if="run?.url"
            :href="run.url"
            target="_blank"
            rel="noopener"
          >
            {{ run.title || run.url }}
          </a>
          <span v-else>{{ run?.title || runId }}</span>
        </h2>
      </div>
      <span
        v-if="run"
        class="focus-run__chip"
        :class="toneClasses(chip.tone)"
        data-focus-chip
      >
        <v-icon :icon="chip.icon" size="14" class="mr-1" />
        {{ chip.title }}
      </span>
      <v-btn
        icon
        variant="text"
        size="small"
        aria-label="Zamknij"
        title="Zamknij"
        data-focus-close
        @click="emit('close')"
      >
        <v-icon :icon="mdiClose" />
      </v-btn>
    </header>

    <v-alert
      v-if="error && !run"
      type="warning"
      variant="tonal"
      density="compact"
      data-focus-error
    >
      {{ error }}
    </v-alert>
    <v-progress-linear v-else-if="!run" indeterminate />

    <template v-if="run">
      <!-- How far: a bar against the total once the job knows it, a moving
           one while it is still working out what to send. -->
      <div v-if="!finished" class="focus-run__progress">
        <v-progress-linear
          :model-value="share === null ? undefined : share * 100"
          :indeterminate="share === null"
          :color="`ink-${chip.tone}`"
          height="8"
          rounded
        />
      </div>

      <p class="focus-run__status text-body-2" data-focus-status>
        {{ statusText }}
      </p>

      <!-- Why a run is still waiting is the machine, which the page that
           asked cannot see: say whether it was started and what to expect. -->
      <div
        v-if="run.state === 'queued' && run.request"
        class="focus-run__dispatch text-body-2"
        data-focus-dispatch
      >
        <template v-if="run.dispatch?.ok">
          Maszynę uruchomiono {{ shortWarsawTime(run.dispatch.at, now) }} -
          zacznie w minutę, dwie.
        </template>
        <template v-else-if="run.dispatch?.error">
          Nie udało się uruchomić maszyny: {{ run.dispatch.error }}. Zlecenie
          poczeka do nocy.
        </template>
        <template v-else>
          Strona nie uruchamia maszyny sama - zlecenie zrobi najbliższa noc
          (04:30).
        </template>
        <!-- Only where the site starts the VM at all: with dispatch off,
             asking again would start nothing either. -->
        <v-btn
          v-if="run.dispatch?.mode === 'vm' && (!run.dispatch.ok || stalled)"
          size="small"
          variant="outlined"
          class="ml-2"
          :loading="redispatching"
          data-focus-redispatch
          @click="redispatch"
        >
          Uruchom maszynę jeszcze raz
        </v-btn>
      </div>

      <div v-if="hasCounters" class="focus-run__counters" data-focus-counters>
        <span
          v-for="[key, value] in counters"
          :key="key"
          class="focus-run__counter"
        >
          {{ counterLabel(key) }}:
          <strong>{{ counterValue(key, value) }}</strong>
        </span>
      </div>

      <p v-if="run.stopReason" class="text-body-2 mb-2" data-focus-reason>
        Powód: {{ run.stopReason }}
      </p>

      <ul
        v-if="run.errors.length"
        class="focus-run__errors text-ink-danger"
        data-focus-errors
      >
        <li v-for="(message, index) in run.errors" :key="index">
          <code>{{ message }}</code>
        </li>
      </ul>

      <dl class="focus-run__facts text-body-2">
        <template v-if="run.request">
          <dt>Zlecono</dt>
          <dd>
            {{ requestedAt }}
            <template v-if="run.request.byName">
              - {{ run.request.byName }}</template
            >
          </dd>
        </template>
        <dt>{{ run.state === "queued" ? "W kolejce od" : "Start" }}</dt>
        <dd>{{ fullTime(run.startedAt) }}</dd>
        <template v-if="run.finishedAt">
          <dt>Koniec</dt>
          <dd>
            {{ fullTime(run.finishedAt) }} ({{
              formatDuration(
                Date.parse(run.finishedAt) - Date.parse(run.startedAt),
              )
            }})
          </dd>
        </template>
        <template v-if="run.host">
          <dt>Gdzie</dt>
          <dd>
            <code>{{ run.host }}</code>
          </dd>
        </template>
        <template v-if="run.summaryPath">
          <dt>Podsumowanie</dt>
          <dd>
            <code class="focus-run__path">{{ run.summaryPath }}</code>
          </dd>
        </template>
      </dl>

      <footer class="focus-run__links text-body-2">
        <NuxtLink
          v-if="!run.request && run.link"
          :to="run.link"
          data-focus-facts
        >
          Zobacz fakty
        </NuxtLink>
        <a :href="`#${jobAnchor(run.job)}`" data-focus-job-link>
          Wszystkie uruchomienia: {{ jobTitle }}
        </a>
        <button
          type="button"
          class="focus-run__copy"
          data-focus-copy
          @click="copyLink"
        >
          <v-icon :icon="copied ? mdiCheck : mdiContentCopy" size="14" />
          {{ copied ? "Skopiowano" : "Kopiuj link" }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { mdiCheck, mdiClose, mdiContentCopy } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { useOpsRun } from "~/composables/opsJobs";
import {
  counterLabel,
  counterValue,
  jobAnchor,
  KNOWN_COUNTERS,
  otherDefinition,
  progressShare,
  progressText,
  runChip,
  toneClasses,
} from "~/utils/jobStyle";
import {
  formatDuration,
  isFinished,
  jobDefinition,
  runAnchor,
  runLink,
  shortWarsawTime,
  WARSAW,
  type JobRun,
} from "~~/shared/jobs";

/** The one run a link names - `/admin/procesy#przebieg-<id>`, which a page's
 * request button and the extension hand out - at the top of the page, read
 * on its own and again every ten seconds until it ends: the list below polls
 * once a minute and shows a job's newest ten runs, and a capture the
 * extension links to may be older than those. */

const props = defineProps<{ runId: string; now: Date }>();
const emit = defineEmits<{
  close: [];
  /** The run, whenever it is read: the page opens its job's row on it. */
  loaded: [run: JobRun];
}>();

const { run, error, load } = useOpsRun(toRef(props, "runId"));

const definition = computed(() => {
  const job = run.value?.job;
  if (!job) return null;
  return (
    jobDefinition(job) ?? otherDefinition({ id: job, runs: [], record: null })
  );
});

const jobTitle = computed(() => definition.value?.title ?? "Proces");

const chip = computed(() =>
  run.value && definition.value
    ? runChip(run.value, definition.value, props.now)
    : { title: "", icon: "", tone: "neutral" as const, stalled: false },
);
const stalled = computed(() => chip.value.stalled);
const finished = computed(() =>
  run.value ? isFinished(run.value.state) : false,
);

const share = computed(() =>
  run.value?.progress ? progressShare(run.value.progress) : null,
);

/** In the order the labels are written in (`KNOWN_COUNTERS`), which puts
 * a request's "w danych" before its "do zmiany", rather than the database's
 * alphabetical one; anything unnamed after them. */
const counters = computed(() =>
  Object.entries(run.value?.counters ?? {}).sort(([a], [b]) => {
    const rank = (key: string) => {
      const index = KNOWN_COUNTERS.indexOf(key);
      return index === -1 ? KNOWN_COUNTERS.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  }),
);
const hasCounters = computed(() => counters.value.length > 0);

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    timeZone: WARSAW,
    dateStyle: "medium",
    timeStyle: "short",
  });

const requestedAt = computed(() => {
  const at = run.value?.request?.at;
  return at ? fullTime(at) : "";
});

/** One line saying where the run is now. */
const statusText = computed(() => {
  const current = run.value;
  if (!current) return "";
  const since = formatDuration(
    props.now.getTime() - Date.parse(current.startedAt),
  );
  const progress = current.progress
    ? ` - ${progressText(current.progress)}`
    : "";
  switch (current.state) {
    case "queued":
      return stalled.value
        ? `Czeka od ${since} i nikt go nie podjął.`
        : `Czeka na maszynę od ${since}.`;
    case "running":
      return stalled.value
        ? `Brak sygnału od ${formatDuration(props.now.getTime() - Date.parse(current.heartbeatAt))}.`
        : `Trwa od ${since}${current.phase ? ` - ${current.phase}` : ""}${progress}.`;
    case "succeeded":
      // A count sent nothing, and "0 z 15 osób" would read as a send that
      // stalled at the start.
      return current.request?.dryRun
        ? "Policzone - nic nie wysłano."
        : `Gotowe${progress}.`;
    case "partial":
      return `Przerwane z zaległościami${progress}.`;
    case "failed":
      return `Błąd${progress}.`;
    default:
      return "";
  }
});

const redispatching = ref(false);
async function redispatch() {
  redispatching.value = true;
  try {
    await authRequest(
      `/api/ops/jobs/runs/${encodeURIComponent(props.runId)}/dispatch`,
    );
  } catch {
    // What came of it is on the run, which is read again below.
  } finally {
    redispatching.value = false;
    await load();
  }
}

const copied = ref(false);
async function copyLink() {
  try {
    await navigator.clipboard.writeText(
      `${window.location.origin}${runLink(props.runId)}`,
    );
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // An insecure origin has no clipboard; the address bar has the link.
  }
}

watch(run, (current) => {
  if (current) emit("loaded", current);
});
</script>

<style scoped>
.focus-run {
  /* Clear of the sticky app bar when a link scrolls to it. */
  scroll-margin-top: 96px;
  padding: 16px 20px;
  border: 2px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
}

.focus-run--info {
  border-color: rgb(var(--v-theme-ink-info));
}
.focus-run--success {
  border-color: rgb(var(--v-theme-ink-success));
}
.focus-run--warning {
  border-color: rgb(var(--v-theme-ink-warning));
}
.focus-run--danger {
  border-color: rgb(var(--v-theme-ink-danger));
}

.focus-run__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.focus-run__heading {
  flex: 1 1 auto;
  min-width: 0;
}

.focus-run__job {
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.focus-run__title {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.focus-run__chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.focus-run__progress {
  margin: 4px 0 8px;
}

.focus-run__status {
  font-weight: 500;
  margin-bottom: 8px;
}

.focus-run__dispatch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.focus-run__counters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-bottom: 8px;
  font-size: 0.875rem;
}

.focus-run__counter {
  padding: 0 6px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-muted));
}

.focus-run__errors {
  margin: 0 0 8px;
  padding-left: 20px;
  font-size: 0.8125rem;
}

.focus-run__errors code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.focus-run__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  margin-bottom: 8px;
}

.focus-run__facts dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.focus-run__facts dd {
  min-width: 0;
  overflow-wrap: anywhere;
}

.focus-run__path {
  font-size: 0.75rem;
  user-select: all;
}

.focus-run__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
}

.focus-run__copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>

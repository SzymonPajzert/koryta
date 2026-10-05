<template>
  <div data-testid="revision-history">
    <v-progress-linear
      v-if="loading && !data"
      indeterminate
      color="ink-sage"
      class="my-2"
      aria-label="Wczytuję historię zmian"
    />
    <v-alert
      v-else-if="failed && !data"
      type="error"
      variant="tonal"
      density="compact"
      class="flex-1-1-100"
    >
      Nie udało się wczytać historii zmian.
    </v-alert>

    <template v-else-if="data">
      <p v-if="rows.length === 0" class="text-body-2 text-medium-emphasis">
        Ten wpis nie ma jeszcze żadnej rewizji.
      </p>

      <template v-else>
        <v-chip-group
          v-model="filter"
          mandatory
          column
          color="ink-sage"
          class="py-0 mb-1"
        >
          <v-chip
            v-for="option in filterOptions"
            :key="option.value"
            :value="option.value"
            size="small"
            variant="outlined"
            filter
            :disabled="option.count === 0 && filter !== option.value"
            :data-testid="`history-filter-${option.value}`"
          >
            {{ option.title }} ({{ option.count }})
          </v-chip>
        </v-chip-group>

        <AdminRowList v-if="shown.length > 0">
          <AdminExpandRow
            v-for="row in shown"
            :key="row.id"
            :row-id="`rev-${row.id}`"
            :tone="revisionStatusTones[row.status]"
            :highlighted="row.id === highlightId"
            :expanded="open.has(row.id)"
            :data-revision-row="row.id"
            @update:expanded="(value: boolean) => setOpen(row.id, value)"
          >
            <template #summary>
              <span class="rev-line">
                <v-icon
                  class="flex-0-0"
                  size="small"
                  :icon="revisionStatusIcons[row.status]"
                  :color="proposalStatusLabels[row.status].color"
                  role="img"
                  aria-hidden="false"
                  :aria-label="proposalStatusLabels[row.status].label"
                  :title="proposalStatusLabels[row.status].label"
                  data-revision-status
                />
                <span class="arow-fixed rev-when text-body-2">
                  {{ formatMoment(row.updateTime) }}
                </span>
                <span
                  class="arow-side rev-author text-body-2 font-weight-bold"
                  :title="authorName(row)"
                  data-revision-author
                >
                  {{ authorName(row) }}
                </span>
                <!-- Where the line breaks on a phone: who and when above, what
                     below. Nothing on a wider screen. -->
                <span class="rev-break" aria-hidden="true" />
                <span
                  class="arow-tag rev-kind"
                  :class="
                    row.automatic
                      ? 'bg-surface-muted text-ink-neutral'
                      : 'bg-surface-sage text-ink-sage'
                  "
                >
                  {{ row.automatic ? "Auto" : "Ręczna" }}
                </span>
                <span
                  class="arow-grow text-body-2 text-medium-emphasis"
                  :title="changeSummary(row)"
                >
                  {{ changeSummary(row) }}
                </span>
                <v-icon
                  v-if="row.stale && row.status === 'pending'"
                  class="flex-0-0"
                  size="small"
                  :icon="mdiAlertOutline"
                  color="ink-warning"
                  role="img"
                  aria-hidden="false"
                  :aria-label="STALE_HINT"
                  :title="STALE_HINT"
                />
              </span>
            </template>

            <template #meta>
              <AdminRowFact label="Autor">
                <UserChip :uid="row.updateUser || null" :user="row.author" />
              </AdminRowFact>
              <AdminRowFact label="Kiedy">
                {{ formatMoment(row.updateTime) }} ·
                {{ formatDaysAgo(row.updateTime) }}
              </AdminRowFact>
              <AdminRowFact label="Rodzaj">
                {{ row.automatic ? "Pipeline" : "Od człowieka" }}
              </AdminRowFact>
              <AdminRowFact label="Status">{{ statusText(row) }}</AdminRowFact>
              <AdminRowFact
                v-if="row.reviewTime || row.reviewUser"
                label="Rozpatrzono"
              >
                <span class="d-inline-flex flex-wrap align-center ga-1">
                  <span v-if="row.reviewTime">
                    {{ formatMoment(row.reviewTime) }}
                  </span>
                  <UserChip v-if="row.reviewUser" :uid="row.reviewUser" />
                </span>
              </AdminRowFact>
              <AdminRowFact
                v-if="row.status === 'rejected' && row.rejectReason"
                label="Powód odrzucenia"
              >
                {{ row.rejectReason }}
              </AdminRowFact>
            </template>

            <p
              v-if="row.kind !== 'removal'"
              class="text-caption text-medium-emphasis mb-1"
            >
              {{ baselineNote(row) }}
            </p>
            <RevisionChangeCell :proposal="row" :max="row.changeCount" wide />
            <NuxtLink
              v-if="row.targetType"
              :to="previewTo(row)"
              target="_blank"
              class="text-ink-info text-body-2 d-inline-flex align-center ga-1 mt-2"
              :data-testid="`history-preview-${row.id}`"
            >
              <v-icon :icon="mdiEyeOutline" size="small" />
              Podgląd tej wersji strony
            </NuxtLink>

            <template v-if="isAdmin" #footer>
              <RevisionReviewActions
                :proposal="row"
                :reviewable="row.status !== 'approved'"
                :rejectable="row.status === 'pending'"
                :loading="deciding === row.id"
                :full-comparison-to="embedded ? comparisonTo(row) : null"
                @approve="(options) => approve(row, options)"
                @reject="openReject(row)"
                @permalink="copyPermalink(row)"
              />
            </template>
          </AdminExpandRow>
        </AdminRowList>
        <p v-else class="text-body-2 text-medium-emphasis">
          Żadna rewizja nie pasuje do wybranego filtra.
        </p>

        <div v-if="embedded" class="d-flex flex-wrap align-center ga-2 mt-2">
          <v-btn
            v-if="hiddenCount > 0"
            size="small"
            variant="text"
            data-testid="history-show-all"
            @click="showAll = true"
          >
            Pokaż wszystkie ({{ filtered.length }})
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="mdiCompare"
            :to="`/admin/rewizje/${nodeId}`"
            data-testid="history-full-page"
          >
            Pełna historia i porównanie
          </v-btn>
        </div>
      </template>
    </template>

    <RevisionRejectDialog
      v-model="rejectOpen"
      :loading="!!rejectTarget && deciding === rejectTarget.id"
      :target-name="rejectTarget?.targetName"
      @confirm="reject"
    />

    <v-snackbar v-model="noticeShown" :timeout="4000">{{ notice }}</v-snackbar>
    <v-snackbar v-model="errorShown" color="error" :timeout="6000">
      {{ error }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
/** Every revision of one entry, a line each, opening into who filed it, what it
 * changes and what can be decided about it.
 *
 * The comparison page used to be the only way to read an entry's history, and
 * it showed it as a table of snapshots: one 350px column per revision, forty
 * screens wide on a company the pipelines re-upload nightly, with the author a
 * bare uid in the column header. Who proposed a change was the question asked
 * most and answered worst. Here the author is the most prominent thing on the
 * line, and the rest waits behind a click - the same shape as the queue on
 * /admin/opinie, which is the list that proved easy to work through.
 *
 * Two homes:
 * - `/admin/rewizje/[id]`, above the comparison table. The row a link arrived
 *   for (`highlightId`) - or else the newest one still waiting - opens on its
 *   own, because that is the one the reviewer came to decide.
 * - `embedded` in an entry's row on `/admin/rewizje`. Nothing opens by itself
 *   there - the reviewer only asked to see the list - and it stops after ten
 *   lines, with the way through to the full page.
 *
 * Data from `/api/revisions/node`, the queue's own description of a revision,
 * so a status or a diff cannot read differently here and in the queue.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { mdiAlertOutline, mdiCompare, mdiEyeOutline } from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { formatDaysAgo } from "~/utils/chartTheme";
import {
  revisionStatusIcons,
  revisionStatusTones,
} from "~/utils/revisionStatus";
import { proposalStatusLabels, type Proposal } from "~~/shared/proposals";
import type { NodeRevisionHistory } from "~~/server/api/revisions/node.get";

type HistoryFilter = "all" | "manual" | "pending";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    /** The revision a link named: outlined, never filtered out, and opened on
     * arrival unless `embedded`. */
    highlightId?: string | null;
    /** Inside another list rather than on a page of its own. */
    embedded?: boolean;
  }>(),
  { highlightId: null, embedded: false },
);

const emit = defineEmits<{
  /** A revision was approved or rejected here, so whatever else the page shows
   * about this entry is now out of date. */
  changed: [];
}>();

/** Bound by the comparison page to its table's own filter, so the list and the
 * columns under it always show the same revisions. */
const filter = defineModel<HistoryFilter>("filter", { default: "all" });

/** How many lines an embedded list shows before "Pokaż wszystkie". */
const EMBEDDED_LIMIT = 10;

const STALE_HINT =
  "Wpis zmienił się po zgłoszeniu — zatwierdzenie cofnie nowsze zmiany.";

const { isAdmin } = useAuthState();

const data = ref<NodeRevisionHistory | null>(null);
const loading = ref(false);
const failed = ref(false);
/** Held here rather than in each row, so a link can open one. */
const open = reactive(new Set<string>());
const showAll = ref(false);

const rows = computed(() => data.value?.revisions ?? []);

/** The same three cuts as the comparison table's columns. "Oczekujące" goes
 * by the resolved status, so an approval a newer one overtook - `Zastąpiona` -
 * is not counted as still waiting, which the table used to do. */
function matches(row: Proposal, value: HistoryFilter): boolean {
  if (value === "manual") return !row.automatic;
  if (value === "pending") return row.status === "pending";
  return true;
}

const filterOptions = computed(() =>
  (
    [
      { value: "all", title: "Wszystkie" },
      { value: "manual", title: "Od ludzi" },
      { value: "pending", title: "Oczekujące" },
    ] as const
  ).map((option) => ({
    ...option,
    count: rows.value.filter((row) => matches(row, option.value)).length,
  })),
);

/** The linked revision is never filtered out: arriving from a link and finding
 * the list empty of the one thing it pointed at reads as a broken link. */
const filtered = computed(() =>
  rows.value.filter(
    (row) => row.id === props.highlightId || matches(row, filter.value),
  ),
);

const shown = computed(() => {
  if (
    !props.embedded ||
    showAll.value ||
    filtered.value.length <= EMBEDDED_LIMIT
  ) {
    return filtered.value;
  }
  const first = filtered.value.slice(0, EMBEDDED_LIMIT);
  const linked = filtered.value.find((row) => row.id === props.highlightId);
  return linked && !first.includes(linked) ? [...first, linked] : first;
});

const hiddenCount = computed(() => filtered.value.length - shown.value.length);

const setOpen = (id: string, value: boolean) => {
  if (value) open.add(id);
  else open.delete(id);
};

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    data.value = await authRequest<NodeRevisionHistory>("/api/revisions/node", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
  } catch (err) {
    console.error("Failed to load the revision history", err);
    // A reload that fails leaves the list it had rather than blanking it; the
    // first load has nothing to leave.
    if (data.value) report(err);
    else failed.value = true;
  } finally {
    loading.value = false;
  }
}

/** On the comparison page, open the row the reviewer came for and bring it
 * into view. `block: "nearest"` so a row already on screen does not move. */
async function openLinked() {
  if (props.embedded) return;
  const target =
    rows.value.find((row) => row.id === props.highlightId) ??
    rows.value.find((row) => row.status === "pending");
  if (!target) return;
  open.add(target.id);
  if (target.id !== props.highlightId) return;
  await nextTick();
  document
    .getElementById(`rev-${target.id}`)
    ?.scrollIntoView({ block: "nearest" });
}

// Client only: the endpoint wants a bearer token, which the server render has
// no way to present.
onMounted(async () => {
  await load();
  await openLinked();
});

watch(
  () => props.nodeId,
  async () => {
    open.clear();
    showAll.value = false;
    data.value = null;
    await load();
    await openLinked();
  },
);

watch(
  () => props.highlightId,
  (id) => {
    if (id && !props.embedded) open.add(id);
  },
);

defineExpose({ reload: load });

/** "24.09.2026 14:05" - the day and the minute, in Warsaw whatever the
 * browser's zone, like every other clock on the site. */
const MOMENT = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

function formatMoment(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : MOMENT.format(date).replace(", ", " ");
}

/** Who filed it, as plain text: the name when this reader may know it, the
 * uid when not, and "pipeline" for the ingest - whose account is somebody's
 * admin login, so its name would say the wrong thing. */
function authorName(row: Proposal): string {
  if (row.automatic) return "pipeline";
  return (
    row.author?.displayName || row.author?.email || row.updateUser || "Nieznany"
  );
}

/** A status nobody recorded is a reading of the data, and says so - the same
 * distinction `ChipRevisionStatus` marks as "odczytany". */
const statusText = (row: Proposal) =>
  row.statusDerived
    ? `${proposalStatusLabels[row.status].label} (odczytany z wpisu)`
    : proposalStatusLabels[row.status].label;

const capitalise = (text: string) =>
  text.charAt(0).toLocaleUpperCase("pl-PL") + text.slice(1);

/** What the revision touches, in field names. */
function changeSummary(row: Proposal): string {
  if (row.kind === "removal") return "Wniosek o usunięcie";
  if (row.id === data.value?.approvedRevisionId) return "Obecna wersja wpisu";
  if (row.changeCount === 0) return "bez zmian";
  return row.changes.map((change) => capitalise(change.label)).join(", ");
}

/** What the diff below is measured against. It is the approved version, not
 * the revision before this one: that is what approving would change, and it is
 * what the queue shows for the same revision. Not said over a removal, whose
 * whole content is its reason. */
function baselineNote(row: Proposal): string {
  const approved = data.value?.approvedRevisionId;
  if (!approved)
    return "Nic nie jest jeszcze zatwierdzone, więc każde pole jest nowe.";
  if (row.id === approved) return "To ta wersja jest teraz zatwierdzona.";
  return "W porównaniu z zatwierdzoną wersją:";
}

/** The entry rendered from this revision rather than from what is stored. */
const previewTo = (row: Proposal) =>
  `/entity/${row.targetType}/${props.nodeId}?revisionId=${row.id}`;

const comparisonTo = (row: Proposal) =>
  `/admin/rewizje/${props.nodeId}?revisionId=${row.id}`;

const notice = ref("");
const noticeShown = ref(false);
const error = ref("");
const errorShown = ref(false);

/** The server's message rather than a generic failure - the ones that matter
 * say something the reviewer has to act on (the live revision cannot be
 * rejected; there is nothing to approve it onto). */
function report(err: unknown) {
  const body = (err as { data?: { message?: string } } | null)?.data;
  error.value =
    body?.message || (err instanceof Error ? err.message : "Wystąpił błąd");
  errorShown.value = true;
}

function announce(text: string) {
  notice.value = text;
  noticeShown.value = true;
}

const deciding = ref<string | null>(null);
const rejectOpen = ref(false);
const rejectTarget = ref<Proposal | null>(null);

/** Re-read after a decision rather than patched in place: approving one
 * revision supersedes whichever was approved before, and the statuses of both
 * have to change together. */
async function approve(row: Proposal, { publish }: { publish: boolean }) {
  deciding.value = row.id;
  try {
    await authRequest("/api/revisions/approve", {
      body: { revision_id: row.id, ...(publish ? { publish: true } : {}) },
    });
    announce(
      publish
        ? "Zatwierdzono tę wersję i opublikowano stronę."
        : "Zatwierdzono tę wersję.",
    );
    await load();
    emit("changed");
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
}

function openReject(row: Proposal) {
  rejectTarget.value = row;
  rejectOpen.value = true;
}

async function reject(reason: string) {
  const row = rejectTarget.value;
  if (!row) return;
  deciding.value = row.id;
  try {
    await authRequest("/api/revisions/reject", {
      body: { revision_id: row.id, reason },
    });
    rejectOpen.value = false;
    announce("Odrzucono tę wersję.");
    await load();
    emit("changed");
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
}

/** The review list's permalink, which resolves a revision whatever its
 * filters say - pasted into a chat, it has to open the same thing tomorrow. */
async function copyPermalink(row: Proposal) {
  const link = `${window.location.origin}/admin/rewizje?rewizja=${encodeURIComponent(row.id)}`;
  try {
    await navigator.clipboard.writeText(link);
    announce("Skopiowano link do propozycji.");
  } catch {
    // A browser that refuses the clipboard still has to leave the reviewer
    // with the link somehow.
    error.value = link;
    errorShown.value = true;
  }
}
</script>

<style scoped>
.rev-line {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rev-when {
  font-variant-numeric: tabular-nums;
}

.rev-break {
  display: none;
}

/* Two lines on a phone: the status, the date and the author, then what
   changed, indented under the date. On one line the author was squeezed to a
   couple of letters, and the author is what the list is for. */
@media (max-width: 599.98px) {
  .rev-line {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  .rev-break {
    display: block;
    flex-basis: 100%;
    height: 0;
  }

  .rev-author {
    flex: 1 1 0;
    max-width: none;
  }

  .rev-kind {
    margin-inline-start: 28px;
  }
}
</style>

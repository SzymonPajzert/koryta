<template>
  <div class="pa-4 revision-compare">
    <div class="d-flex align-center mb-4">
      <v-btn
        :icon="mdiArrowLeft"
        variant="text"
        class="mr-2"
        to="/admin/rewizje"
      ></v-btn>
      <div>
        <h1 class="text-h4">
          Szczegóły rewizji: {{ nodeName || route.params.id }}
        </h1>
        <div v-if="nodeName" class="text-caption text-grey-darken-1">
          Węzeł {{ route.params.id }}
        </div>
      </div>
      <v-spacer />
      <div v-if="!pending" class="d-flex align-center ga-2">
        <v-chip
          :color="published ? 'success' : 'grey'"
          size="small"
          :prepend-icon="published ? mdiEarth : mdiEyeOffOutline"
        >
          {{ published ? "Opublikowana" : "Nieopublikowana" }}
        </v-chip>
        <v-btn
          v-if="isAdmin"
          :color="published ? 'grey' : 'success'"
          size="small"
          :loading="publishPending"
          :disabled="!published && !approvedRevisionId"
          data-testid="publish-toggle"
          @click="published ? setPublished(false) : (publishDialog = true)"
        >
          {{ published ? "Ukryj" : "Opublikuj" }}
          <v-tooltip
            v-if="!published && !approvedRevisionId"
            activator="parent"
            location="bottom"
            max-width="280"
          >
            Strona potrzebuje zatwierdzonej rewizji, żeby można było ją
            opublikować.
          </v-tooltip>
        </v-btn>
      </div>
    </div>

    <!-- One column per revision, so a company the pipelines have re-uploaded
         forty times is forty screens wide. The filter is what makes that
         readable; the scrolling below it is what makes it reachable. -->
    <div
      v-if="!pending && allRevisions.length > 0"
      class="d-flex flex-wrap ga-3 align-center mb-4"
    >
      <v-btn-toggle
        v-model="columnFilter"
        density="compact"
        variant="outlined"
        divided
        mandatory
      >
        <v-btn
          v-for="option in filterOptions"
          :key="option.value"
          :value="option.value"
          size="small"
          :data-testid="`revision-filter-${option.value}`"
        >
          {{ option.title }} ({{ option.count }})
        </v-btn>
      </v-btn-toggle>
      <span class="text-caption text-medium-emphasis">
        Pokazano {{ shownRevisions.length }} z {{ allRevisions.length }}.
      </span>
    </div>

    <v-card v-if="pending" class="pa-4 text-center">
      <v-progress-circular indeterminate></v-progress-circular>
    </v-card>
    <div v-else class="comparison-scroll pb-4">
      <client-only>
        <table v-if="shownRevisions.length > 0" class="comparison-table">
          <thead>
            <tr>
              <th
                v-for="rev in shownRevisions"
                :key="'h-' + rev.id"
                :data-revision-header="rev.id"
                class="card-header text-left"
                :class="{
                  'highlighted-revision': rev.id === route.query.revisionId,
                }"
              >
                <div class="d-flex justify-space-between align-start mb-2">
                  <div>
                    <div class="text-h6 font-weight-medium">
                      {{ formatDate(rev.update_time) }}
                    </div>
                    <div class="mt-1">
                      <UserChip :uid="revisionUser(rev)" />
                    </div>
                  </div>
                  <div class="d-flex flex-column align-end ga-1">
                    <v-chip
                      v-if="rev.id === approvedRevisionId"
                      color="success"
                      size="x-small"
                      :prepend-icon="mdiCheckDecagramOutline"
                    >
                      Zatwierdzona
                      <v-tooltip
                        activator="parent"
                        location="bottom"
                        max-width="280"
                      >
                        Ta wersja jest zatwierdzoną rewizją węzła (pole
                        revision_id). Widoczna publicznie tylko jeśli węzeł jest
                        opublikowany.
                      </v-tooltip>
                    </v-chip>
                    <v-chip
                      v-else-if="rev.status === 'rejected'"
                      color="error"
                      size="x-small"
                      :prepend-icon="mdiCloseCircleOutline"
                    >
                      Odrzucona
                      <v-tooltip
                        v-if="rev.reject_reason"
                        activator="parent"
                        location="bottom"
                        max-width="280"
                      >
                        {{ rev.reject_reason }}
                      </v-tooltip>
                    </v-chip>
                    <v-chip
                      v-else
                      color="warning"
                      size="x-small"
                      :prepend-icon="mdiClockOutline"
                    >
                      Oczekuje
                    </v-chip>
                    <v-chip
                      :color="rev.update_automatic ? 'info' : 'secondary'"
                      size="x-small"
                    >
                      {{ rev.update_automatic ? "Auto" : "Ręczna" }}
                    </v-chip>
                  </div>
                </div>

                <div
                  v-if="isAdmin && rev.id !== approvedRevisionId"
                  class="d-flex ga-2 mb-2"
                >
                  <v-btn
                    color="success"
                    size="small"
                    variant="tonal"
                    :loading="reviewPendingId === rev.id"
                    :prepend-icon="mdiCheck"
                    :data-testid="`approve-${rev.id}`"
                    @click="approve(String(rev.id))"
                  >
                    Zatwierdź
                  </v-btn>
                  <v-btn
                    v-if="rev.status !== 'rejected'"
                    color="error"
                    size="small"
                    variant="text"
                    :prepend-icon="mdiClose"
                    :data-testid="`reject-${rev.id}`"
                    @click="openReject(String(rev.id))"
                  >
                    Odrzuć
                  </v-btn>
                </div>
                <div class="mt-1">
                  <nuxt-link
                    v-if="getRevisionData(rev.data)['type']"
                    :to="`/entity/${getRevisionData(rev.data)['type']}/${nodeId}?revisionId=${rev.id}`"
                    class="text-decoration-none text-primary font-weight-bold d-inline-flex align-center ga-1"
                    target="_blank"
                  >
                    <v-icon :icon="mdiEyeOutline" size="small" />
                    Podgląd tej wersji strony
                    <v-tooltip
                      activator="parent"
                      location="bottom"
                      max-width="300"
                    >
                      Kliknij, aby zobaczyć, jak wyglądałaby strona po
                      opublikowaniu tej wersji.
                    </v-tooltip>
                  </nuxt-link>
                  <div class="text-caption font-weight-mono text-grey mt-1">
                    ID: {{ rev.id }}
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in allKeys" :key="key">
              <td
                v-for="rev in shownRevisions"
                :key="key + '-' + rev.id"
                class="card-cell"
                :class="{
                  'highlighted-revision': rev.id === route.query.revisionId,
                  'changed-field': differsFromApproved(rev, key),
                }"
              >
                <div
                  class="field-label text-caption text-primary font-weight-bold mb-1"
                >
                  {{ key }}
                </div>
                <div class="field-value text-body-2">
                  <template
                    v-if="
                      rev.data && getRevisionData(rev.data)[key] !== undefined
                    "
                  >
                    <pre
                      class="mb-0"
                      style="white-space: pre-wrap; font-family: inherit"
                      >{{
                        typeof getRevisionData(rev.data)[key] === "object"
                          ? JSON.stringify(
                              getRevisionData(rev.data)[key],
                              null,
                              2,
                            )
                          : getRevisionData(rev.data)[key]
                      }}</pre>
                  </template>
                  <template v-else>
                    <span class="text-grey-lighten-1 font-italic"
                      >- brak -</span
                    >
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <v-card v-else class="pa-6 text-center text-grey">
          {{
            allRevisions.length > 0
              ? "Żadna rewizja nie pasuje do wybranego filtra."
              : "Brak rewizji dla tego węzła."
          }}
        </v-card>
      </client-only>
    </div>

    <v-dialog v-model="rejectDialog" max-width="480">
      <v-card>
        <v-card-title>Odrzuć rewizję</v-card-title>
        <v-card-text>
          <p class="mb-3 text-body-2">
            Rewizja zostaje zachowana wraz z powodem - to jedyne, co wróci do
            osoby, która ją zgłosiła.
          </p>
          <v-textarea
            v-model="rejectReason"
            label="Powód odrzucenia"
            placeholder="np. brak źródła, dane niezgodne z KRS"
            rows="3"
            auto-grow
            data-testid="reject-reason"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">Anuluj</v-btn>
          <v-btn
            color="error"
            :disabled="!rejectReason.trim()"
            :loading="reviewPendingId === rejectTarget"
            data-testid="reject-confirm"
            @click="reject()"
          >
            Odrzuć
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AdminPublishNodeDialog
      v-model="publishDialog"
      :node-id="nodeId"
      :node-name="nodeName"
      @published="onPublished"
      @failed="onPublishFailed"
    />

    <v-snackbar v-model="errorShown" color="error" :timeout="6000">
      {{ error }}
    </v-snackbar>

    <v-snackbar v-model="noticeShown" color="info" :timeout="6000">
      {{ notice }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
import { useRoute } from "vue-router";
import { ClientOnly } from "#components";
import { relationsPlural } from "~/composables/edges";
import {
  mdiArrowLeft,
  mdiEyeOutline,
  mdiEyeOffOutline,
  mdiEarth,
  mdiCheck,
  mdiCheckDecagramOutline,
  mdiClockOutline,
  mdiClose,
  mdiCloseCircleOutline,
} from "@mdi/js";

definePageMeta({
  middleware: "auth",
  fullWidth: true,
});

useHead({
  title: "Szczegóły rewizji - koryta.pl",
});

const route = useRoute();
const nodeId = route.params.id as string;

const { isAdmin } = useAuthState();

const revisions = ref<Record<string, unknown>[]>([]);
const approvedRevisionId = ref<string | null>(null);
const published = ref(false);
const pending = ref(true);
const publishPending = ref(false);
const reviewPendingId = ref<string | null>(null);
const error = ref<string | null>(null);
const errorShown = ref(false);
const notice = ref<string | null>(null);
const noticeShown = ref(false);
const publishDialog = ref(false);
const rejectDialog = ref(false);
const rejectReason = ref("");
const rejectTarget = ref<string | null>(null);

async function load() {
  const data = await $fetch<{
    revisions: Record<string, unknown>[];
    approvedRevisionId: string | null;
    published: boolean;
  }>("/api/revisions/byNode", { params: { nodeId } });
  revisions.value = data.revisions;
  approvedRevisionId.value = data.approvedRevisionId;
  published.value = data.published;
}

onMounted(async () => {
  try {
    await load();
  } catch (err) {
    console.error("Failed to fetch revisions:", err);
  } finally {
    pending.value = false;
  }
});

/** Surfaces the server's message rather than a generic failure - the two that
 * matter both say something the reviewer has to act on (a page needs an
 * approved revision before it can go live; the live revision cannot be
 * rejected). */
function report(err: unknown) {
  const data = (err as { data?: { message?: string } } | null)?.data;
  error.value =
    data?.message || (err instanceof Error ? err.message : "Wystąpił błąd");
  errorShown.value = true;
}

/** Hiding the page. Going the other way runs through the dialog, which is
 * where the relations that could go live with it are chosen. */
async function setPublished(value: boolean) {
  publishPending.value = true;
  try {
    const result = await authRequest<{
      published: boolean;
      hiddenEdges?: string[];
    }>("/api/nodes/publish", { body: { node_id: nodeId, published: value } });
    published.value = result.published;
    // Hiding a page hides its relations too, and silently doing that to a
    // reviewer who only meant to hide one page is how they find out much
    // later.
    const hidden = result.hiddenEdges?.length ?? 0;
    if (hidden > 0) {
      notice.value = `Ukryto stronę i ${hidden} ${relationsPlural(hidden)}.`;
      noticeShown.value = true;
    }
  } catch (err) {
    report(err);
  } finally {
    publishPending.value = false;
  }
}

/** A refusal from the relations half leaves the page live and the toggle above
 * still reading "draft", so this reloads as well as reports: the reviewer is
 * being told the page was published, and the screen has to agree with that. */
async function onPublishFailed({
  error: err,
  nodePublished,
}: {
  error: unknown;
  nodePublished: boolean;
}) {
  report(err);
  if (nodePublished) {
    error.value = `Strona została opublikowana, ale powiązania nie: ${error.value}`;
    await load();
  }
}

async function onPublished({ relations }: { relations: number }) {
  notice.value =
    relations > 0
      ? `Opublikowano stronę i ${relations} ${relationsPlural(relations)}.`
      : "Opublikowano stronę.";
  noticeShown.value = true;
  await load();
}

async function approve(revisionId: string) {
  reviewPendingId.value = revisionId;
  try {
    await authRequest("/api/revisions/approve", {
      body: { revision_id: revisionId },
    });
    await load();
  } catch (err) {
    report(err);
  } finally {
    reviewPendingId.value = null;
  }
}

function openReject(revisionId: string) {
  rejectTarget.value = revisionId;
  rejectReason.value = "";
  rejectDialog.value = true;
}

async function reject() {
  const revisionId = rejectTarget.value;
  if (!revisionId) return;
  reviewPendingId.value = revisionId;
  try {
    await authRequest("/api/revisions/reject", {
      body: { revision_id: revisionId, reason: rejectReason.value.trim() },
    });
    rejectDialog.value = false;
    await load();
  } catch (err) {
    report(err);
  } finally {
    reviewPendingId.value = null;
  }
}

/** The review queue links here naming one revision, and the tint that marks it
 * is worth nothing if it is off to the right of a table wide enough to scroll.
 * Scrolled once the columns exist, `inline: "center"` so the neighbours it is
 * being compared against come with it, and `block: "nearest"` so the page does
 * not jump away from the publish controls above. */
const scrollToHighlighted = async () => {
  if (import.meta.server) return;
  const id = route.query.revisionId;
  if (typeof id !== "string" || !id) return;
  await nextTick();
  document
    .querySelector(`[data-revision-header="${id}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "center" });
};

const allRevisions = computed(() => {
  return [...revisions.value].sort((a, b) => {
    const timeA = new Date(parseTime(a.update_time)).getTime();
    const timeB = new Date(parseTime(b.update_time)).getTime();
    return timeB - timeA;
  });
});

/** Which columns to draw. A node the pipelines re-upload nightly carries
 * dozens of revisions saying the same thing, and every one of them is a
 * 350px column between the reviewer and the proposal they came to read. */
type ColumnFilter = "all" | "manual" | "pending";

const columnFilter = ref<ColumnFilter>("all");

/** The three states the header chips already name, worked out the same way so
 * that the filter and the chip on a column cannot disagree. */
function isPendingRevision(rev: Record<string, unknown>) {
  return rev.id !== approvedRevisionId.value && rev.status !== "rejected";
}

const filterOptions = computed(() => [
  {
    value: "all" as const,
    title: "Wszystkie",
    count: allRevisions.value.length,
  },
  {
    value: "manual" as const,
    title: "Od ludzi",
    count: allRevisions.value.filter((rev) => rev.update_automatic !== true)
      .length,
  },
  {
    value: "pending" as const,
    title: "Oczekujące",
    count: allRevisions.value.filter(isPendingRevision).length,
  },
]);

/**
 * The columns actually drawn.
 *
 * The revision named by `?revisionId=` is never filtered out: the queue and
 * every "podgląd" link arrive pointing at one, and dropping it would answer
 * that link with a table the reviewer has to guess their way back out of.
 */
const shownRevisions = computed(() => {
  const highlighted = route.query.revisionId;
  return allRevisions.value.filter((rev) => {
    if (rev.id === highlighted) return true;
    if (columnFilter.value === "manual") return rev.update_automatic !== true;
    if (columnFilter.value === "pending") return isPendingRevision(rev);
    return true;
  });
});

watch(
  () => [shownRevisions.value.length, route.query.revisionId] as const,
  scrollToHighlighted,
  { immediate: true },
);

// The node name isn't stored on the revision list directly, so derive it from
// the most recent revision that carries a `name` in its data snapshot. Names
// rarely change, so the latest available one is a safe label for the node.
const nodeName = computed<string | null>(() => {
  for (const rev of allRevisions.value) {
    const name = getRevisionData(rev.data)["name"];
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return null;
});

const allKeys = computed(() => {
  const keys = new Set<string>();
  // Over the drawn columns, so filtering out the pipeline's uploads takes
  // their fields with them rather than leaving rows reading "- brak -".
  for (const rev of shownRevisions.value) {
    if (rev.data && typeof rev.data === "object") {
      for (const k of Object.keys(rev.data as Record<string, unknown>)) {
        keys.add(k);
      }
    }
  }
  keys.delete("revision_id");
  return Array.from(keys).sort();
});

function parseTime(val: unknown): string | number {
  if (!val) return 0;
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    if (typeof (val as { toDate?: () => unknown }).toDate === "function")
      return (val as { toDate: () => { toISOString: () => string } })
        .toDate()
        .toISOString();
    if (
      "_seconds" in val &&
      typeof (val as { _seconds: number })._seconds === "number"
    )
      return (val as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

function formatDate(val: unknown) {
  const time = parseTime(val);
  if (!time) return "-";
  return new Date(time).toLocaleString("pl-PL");
}

function revisionUser(rev: Record<string, unknown>): string | null {
  return typeof rev.update_user === "string" ? rev.update_user : null;
}

function getRevisionData(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return {};
}

/** The revision the page is serving right now, which is what every other
 * column is worth reading against. */
const approvedRevision = computed(() =>
  allRevisions.value.find((rev) => rev.id === approvedRevisionId.value),
);

/** Whether `key` says something different here than in the approved revision.
 *
 * A revision is a full snapshot, so most of its fields are copies of what is
 * already live and the handful that actually changed is what a reviewer needs
 * to find. Compared as JSON, since values range from strings to arrays of
 * them. Everything is "changed" while nothing is approved yet - on a brand new
 * entry that is the truth. */
function differsFromApproved(rev: Record<string, unknown>, key: string) {
  const approved = approvedRevision.value;
  if (!approved) return true;
  if (rev.id === approved.id) return false;
  return (
    JSON.stringify(getRevisionData(rev.data)[key] ?? null) !==
    JSON.stringify(getRevisionData(approved.data)[key] ?? null)
  );
}
</script>

<style scoped>
/* The layout wraps every page in a `v-container.fill-height`, which Vuetify
   implements as a flex row - and a flex item does not shrink below its own
   content. So a table wide enough to scroll stretched the page instead, and
   `html { overflow-x: hidden }`, which Vuetify also sets, then clipped the
   right-hand revisions off with no way to reach them. `min-width: 0` hands the
   overflow back to the scroller below, which is where it belongs. */
.revision-compare {
  width: 100%;
  min-width: 0;
}

.comparison-scroll {
  overflow: auto;
  /* The sideways scrollbar belongs at the bottom of the window. Left to the
     page it sat at the bottom of a table as tall as the field list, so on a
     node with thirty fields reaching it meant scrolling past everything it
     was there to move. */
  max-height: calc(100vh - 16rem);
}

.comparison-table {
  border-collapse: separate;
  border-spacing: 16px 0;
}
.comparison-table th,
.comparison-table td {
  width: 350px;
  min-width: 300px;
  max-width: 400px;
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  border-left: 1px solid rgba(0, 0, 0, 0.12);
  border-right: 1px solid rgba(0, 0, 0, 0.12);
  vertical-align: top;
}
.card-header {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  padding-top: 20px;
}
.comparison-table tbody tr:last-child td {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
  padding-bottom: 20px;
}
.comparison-table tbody tr td {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}
.highlighted-revision {
  background: rgba(var(--v-theme-primary), 0.1) !important;
}
/* What this revision would change, so a reviewer reads the diff rather than
   the whole snapshot. */
.changed-field {
  background: rgba(var(--v-theme-warning), 0.12) !important;
}
.changed-field .field-label {
  color: rgb(var(--v-theme-warning)) !important;
}
</style>

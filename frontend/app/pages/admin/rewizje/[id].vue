<template>
  <div class="w-100 revision-compare">
    <AdminPageHead
      :title="`Szczegóły rewizji: ${nodeName || route.params.id}`"
      :lead="nodeName ? `Węzeł ${route.params.id}` : undefined"
    >
      <template #back>
        <v-btn
          variant="text"
          size="small"
          :prepend-icon="mdiArrowLeft"
          to="/admin/rewizje#wpisy"
        >
          Rewizje
        </v-btn>
      </template>
      <template v-if="!pending && !loadFailed" #actions>
        <v-chip
          :color="published ? 'ink-success' : 'ink-neutral'"
          size="small"
          :prepend-icon="published ? mdiEarth : mdiEyeOffOutline"
        >
          {{ published ? "Opublikowana" : "Nieopublikowana" }}
        </v-chip>
        <v-btn
          v-if="isAdmin"
          :color="published ? 'ink-neutral' : 'ink-success'"
          :loading="publishPending"
          :disabled="!published && !canPublish"
          data-testid="publish-toggle"
          @click="published ? setPublished(false) : (publishDialog = true)"
        >
          {{ published ? "Ukryj" : "Opublikuj" }}
          <v-tooltip
            v-if="!published && autoApproveRevision"
            activator="parent"
            location="bottom"
            max-width="280"
          >
            Ta strona nie ma zatwierdzonej rewizji - opublikowanie zatwierdzi
            najnowszą, z {{ formatDate(autoApproveRevision.update_time) }}.
          </v-tooltip>
        </v-btn>
        <!-- Why the button above is greyed out, as text: Vuetify gives a
             disabled v-btn `pointer-events: none`, so the tooltip this used
             to have could never open. ReviewActions says its own the same
             way. -->
        <span
          v-if="isAdmin && !published && !canPublish"
          class="text-caption text-medium-emphasis"
          data-testid="publish-unavailable"
        >
          Nie ma czego opublikować – żadnej rewizji nie da się zatwierdzić
        </span>
      </template>
    </AdminPageHead>

    <div class="k-sections">
      <!-- Who proposed what, a line each, and where the decisions are taken.
           Above the table because it is what a reviewer arriving from a link
           came for; the table below is for reading whole versions. -->
      <section>
        <AdminSectionHead
          title="Historia zmian"
          :count="pending || loadFailed ? undefined : allRevisions.length"
          info="Każda rewizja to pełna wersja wpisu, zapisana przez człowieka albo przez pipeline. Kliknij wiersz, żeby zobaczyć, kto ją zgłosił i co zmienia względem zatwierdzonej wersji – i tam ją rozpatrzyć."
        />
        <RevisionHistoryList
          ref="history"
          v-model:filter="columnFilter"
          :node-id="nodeId"
          :highlight-id="highlightId"
          @changed="refresh"
        />
      </section>

      <section>
        <!-- One column per revision, so a company the pipelines have
             re-uploaded forty times is forty screens wide. The filter is what
             makes that readable; the scrolling below it is what makes it
             reachable. It is the list's filter too - both show the same
             revisions - and drawn the same way: chips wrap on a phone, where
             the three-button toggle this used to be was wider than the screen
             and clipped its last button. -->
        <AdminSectionHead
          title="Porównanie obok siebie"
          info="Te same rewizje w kolumnach, pole pod polem, do czytania całych wersji. Pola, które różnią się od zatwierdzonej wersji, są podświetlone."
        >
          <template v-if="!pending && allRevisions.length > 0">
            <v-chip-group
              v-model="columnFilter"
              mandatory
              column
              color="ink-sage"
              class="py-0"
            >
              <v-chip
                v-for="option in filterOptions"
                :key="option.value"
                :value="option.value"
                size="small"
                variant="outlined"
                filter
                :disabled="option.count === 0 && columnFilter !== option.value"
                :data-testid="`revision-filter-${option.value}`"
              >
                {{ option.title }} ({{ option.count }})
              </v-chip>
            </v-chip-group>
            <span class="text-caption text-medium-emphasis">
              Pokazano {{ shownRevisions.length }} z {{ allRevisions.length }}.
            </span>
          </template>
        </AdminSectionHead>

        <!-- A note about what is not there yet has no edge and no fill. -->
        <div
          v-if="pending"
          class="d-flex align-center ga-2 text-body-2 text-medium-emphasis"
        >
          <v-progress-circular indeterminate size="20" width="2" />
          Wczytuję rewizje…
        </div>
        <v-alert
          v-else-if="loadFailed"
          type="error"
          variant="tonal"
          density="compact"
          text="Nie udało się wczytać rewizji tego wpisu."
        />
        <div
          v-else
          ref="scroller"
          class="comparison-scroll pb-4"
          :class="{
            'k-bleed-xs': shownRevisions.length > 0,
            'comparison-scroll--capped': overflowsSideways,
          }"
        >
          <client-only>
            <table
              v-if="shownRevisions.length > 0"
              ref="table"
              class="comparison-table"
            >
              <thead>
                <tr>
                  <th
                    v-for="rev in shownRevisions"
                    :key="'h-' + rev.id"
                    :data-revision-header="rev.id"
                    class="card-header text-left"
                    :class="{
                      'highlighted-revision': rev.id === highlightId,
                    }"
                  >
                    <div class="d-flex justify-space-between align-start mb-2">
                      <div>
                        <div class="text-subtitle-1 font-weight-medium">
                          {{ formatDate(rev.update_time) }}
                        </div>
                        <div class="mt-1">
                          <UserChip :uid="revisionUser(rev)" />
                        </div>
                      </div>
                      <div class="d-flex flex-column align-end ga-1">
                        <!-- The same resolution the list above and the queue
                             make: an approval a newer one overtook is
                             `Zastąpiona`, where this used to say `Oczekuje`. -->
                        <ChipRevisionStatus
                          :status="statusOf(rev)"
                          size="x-small"
                        />
                        <v-chip
                          :color="
                            rev.update_automatic ? 'ink-neutral' : 'ink-sage'
                          "
                          size="x-small"
                        >
                          {{ rev.update_automatic ? "Auto" : "Ręczna" }}
                        </v-chip>
                      </div>
                    </div>

                    <div class="mt-1">
                      <nuxt-link
                        v-if="getRevisionData(rev.data)['type']"
                        :to="`/entity/${getRevisionData(rev.data)['type']}/${nodeId}?revisionId=${rev.id}`"
                        class="text-decoration-none text-ink-info text-body-2 font-weight-medium d-inline-flex align-center ga-1"
                        target="_blank"
                      >
                        <v-icon :icon="mdiEyeOutline" size="small" />
                        Podgląd tej wersji strony
                      </nuxt-link>
                      <!-- Full id on hover only: spelled out it is ~60
                           monospace characters, which widened the column past the
                           350px the comparison table gives it and pushed the
                           header controls out of view. -->
                      <div
                        class="text-caption font-weight-mono text-medium-emphasis mt-1 revision-id"
                        :title="String(rev.id)"
                      >
                        ID: {{ shortRevisionId(rev.id) }}
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
                    :class="{
                      'highlighted-revision': rev.id === highlightId,
                      'changed-field': differsFromApproved(rev, key),
                    }"
                  >
                    <!-- The name the diff above uses, „Opis” rather than
                         `content`; the stored key on hover. -->
                    <div
                      class="field-label text-caption text-ink-sage font-weight-semibold mb-1"
                      :title="key"
                    >
                      {{ fieldName(key) }}
                    </div>
                    <!-- A list reads as one, „PO, PiS”, the way the diff
                         prints it, rather than as JSON brackets; and every
                         way of having nothing - no key, null, "", [] - says
                         „brak” alike, where a blank cell used to stand
                         beside „- brak -” for the same absence. -->
                    <div class="field-value text-body-2">
                      <pre v-if="fieldText(rev, key)" class="mb-0">{{
                        fieldText(rev, key)
                      }}</pre>
                      <span v-else class="text-medium-emphasis font-italic"
                        >– brak –</span
                      >
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-body-2 text-medium-emphasis mb-0">
              {{
                allRevisions.length > 0
                  ? "Żadna rewizja nie pasuje do wybranego filtra."
                  : "Brak rewizji dla tego węzła."
              }}
            </p>
          </client-only>
        </div>
      </section>
    </div>

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
import { useResizeObserver } from "@vueuse/core";
import { relationsPlural } from "~/composables/edges";
import { formatMoment } from "~/utils/moment";
import { latestPublishableRevision } from "~~/shared/revisions";
import {
  capitaliseLabel,
  renderFieldValue,
  revisionFieldLabel,
  skippedChangeFields,
} from "~~/shared/revisionChanges";
import {
  resolveProposalStatus,
  type ProposalStatus,
} from "~~/shared/proposals";
import {
  mdiArrowLeft,
  mdiEyeOutline,
  mdiEyeOffOutline,
  mdiEarth,
} from "@mdi/js";

definePageMeta({
  middleware: "auth",
});

useHead({
  title: "Szczegóły rewizji - koryta.pl",
});

const route = useRoute();
const nodeId = route.params.id as string;

/** The revision a link arrived for: the queue, an entity page's "Zobacz
 * historię zmian", a "Porównanie" button on the review list. */
const highlightId = computed(() =>
  typeof route.query.revisionId === "string" && route.query.revisionId
    ? route.query.revisionId
    : null,
);

const { isAdmin } = useAuthState();

const revisions = ref<Record<string, unknown>[]>([]);
const approvedRevisionId = ref<string | null>(null);
const published = ref(false);
const pending = ref(true);
/** The first read failed, which is not the same as an entry with no
 * revisions - and said as such, rather than as „Brak rewizji”. */
const loadFailed = ref(false);
const publishPending = ref(false);
const error = ref<string | null>(null);
const errorShown = ref(false);
const notice = ref<string | null>(null);
const noticeShown = ref(false);
const publishDialog = ref(false);
const history = ref<{ reload: () => Promise<void> } | null>(null);

async function load() {
  // With the token: the endpoint answers nobody else.
  const data = await authRequest<{
    revisions: Record<string, unknown>[];
    approvedRevisionId: string | null;
    published: boolean;
  }>("/api/revisions/byNode", { method: "GET", query: { nodeId } });
  revisions.value = data.revisions;
  approvedRevisionId.value = data.approvedRevisionId;
  published.value = data.published;
  loadFailed.value = false;
}

onMounted(async () => {
  try {
    await load();
  } catch (err) {
    console.error("Failed to fetch revisions:", err);
    loadFailed.value = true;
  } finally {
    pending.value = false;
  }
});

/** A decision taken in the list redraws the table: the approved column moves,
 * and with it every "changed" tint. */
async function refresh() {
  try {
    await load();
  } catch (err) {
    report(err);
  }
}

/** Publishing moves the other way: the list's "Zatwierdź i opublikuj" depends
 * on whether the page is live, and publishing can approve a revision. */
async function reloadAll() {
  await Promise.all([load(), history.value?.reload()]);
}

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
    await history.value?.reload();
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
    await reloadAll();
  }
}

async function onPublished({
  relations,
  approvedRevisionId: approved,
}: {
  relations: number;
  approvedRevisionId?: string;
}) {
  const page =
    relations > 0
      ? `Opublikowano stronę i ${relations} ${relationsPlural(relations)}.`
      : "Opublikowano stronę.";
  // The approval was not asked for in so many words, so it is said out loud -
  // the reviewer clicked "publish" and a version of the page was chosen for
  // them, and the table below is about to redraw with a new "Zatwierdzona".
  notice.value = approved
    ? `${page} Zatwierdzono przy tym jej najnowszą rewizję.`
    : page;
  noticeShown.value = true;
  await reloadAll();
}

/** Whether the table is wider than its scroller, which is the only time the
 * scroller is given a height of its own (`comparison-scroll--capped`). The
 * scroller exists only once `pending` is over, and the table only once
 * ClientOnly has drawn it, so both are watched through refs that fill in
 * later: the table for a filter that drops or brings back columns, the
 * scroller for the window changing width. */
const scroller = ref<HTMLElement | null>(null);
const table = ref<HTMLElement | null>(null);
const overflowsSideways = ref(false);
useResizeObserver([scroller, table], () => {
  const el = scroller.value;
  overflowsSideways.value = !!el && el.scrollWidth > el.clientWidth + 1;
});

/** The review queue links here naming one revision, and the tint that marks it
 * is worth nothing if it is off to the right of a table wide enough to scroll.
 * Scrolled once the columns exist, centred so the neighbours it is being
 * compared against come with it - and only sideways, inside the table's own
 * scroller: the history list above is where the link lands now, with that
 * revision open, and moving the page down to the table would carry the
 * reviewer straight past it. */
const scrollToHighlighted = async () => {
  if (import.meta.server) return;
  const id = highlightId.value;
  if (!id) return;
  await nextTick();
  const header = document.querySelector<HTMLElement>(
    `[data-revision-header="${id}"]`,
  );
  const box = header?.closest<HTMLElement>(".comparison-scroll");
  if (!header || !box) return;
  const offset =
    header.getBoundingClientRect().left - box.getBoundingClientRect().left;
  box.scrollLeft += offset - (box.clientWidth - header.offsetWidth) / 2;
};

const allRevisions = computed(() => {
  return [...revisions.value].sort((a, b) => {
    const timeA = new Date(parseTime(a.update_time)).getTime();
    const timeB = new Date(parseTime(b.update_time)).getTime();
    return timeB - timeA;
  });
});

/** The revision publishing would approve, where nothing is approved yet.
 *
 * The same choice `/api/nodes/publish` makes, made here so the button can say
 * which version it is about to put in front of readers rather than leaving the
 * reviewer to find out afterwards.
 */
const autoApproveRevision = computed(() => {
  if (approvedRevisionId.value) return null;
  return latestPublishableRevision(
    allRevisions.value as (Record<string, unknown> & { id: string })[],
  );
});

/** Whether there is anything to publish: an approved revision, or one that
 * publishing would approve. A page whose only revisions are rejected or ask
 * for its removal has neither. */
const canPublish = computed(
  () => Boolean(approvedRevisionId.value) || Boolean(autoApproveRevision.value),
);

/** Which columns to draw. A node the pipelines re-upload nightly carries
 * dozens of revisions saying the same thing, and every one of them is a
 * 350px column between the reviewer and the proposal they came to read. */
type ColumnFilter = "all" | "manual" | "pending";

const columnFilter = ref<ColumnFilter>("all");

/** Where a revision stands, worked out the way the queue and the history list
 * work it out - so a column header, the filter and the row above it cannot
 * disagree. */
function statusOf(rev: Record<string, unknown>): ProposalStatus {
  return resolveProposalStatus({
    id: String(rev.id),
    status: rev.status,
    approvedId: approvedRevisionId.value ?? undefined,
  }).status;
}

/** Still waiting for a decision. Not an approval a newer one overtook, which
 * this used to count - and label `Oczekuje` - because it only compared ids. */
function isPendingRevision(rev: Record<string, unknown>) {
  return statusOf(rev) === "pending";
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
  return allRevisions.value.filter((rev) => {
    if (rev.id === highlightId.value) return true;
    if (columnFilter.value === "manual") return rev.update_automatic !== true;
    if (columnFilter.value === "pending") return isPendingRevision(rev);
    return true;
  });
});

watch(
  () => [shownRevisions.value.length, highlightId.value] as const,
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

/** The fields the table has a row for, in the diff's order: by their Polish
 * names. Sorted by the stored key they read „data urodzenia, opis, ktomaco,
 * nazwa, partie” - alphabetical in English, which in Polish is no order at
 * all. The bookkeeping the diff leaves out (`skippedChangeFields`: the type,
 * `partiesSource`, `revision_id`, counters) is left out here too; none of it
 * is something a reviewer reads a version for. */
const allKeys = computed(() => {
  const keys = new Set<string>();
  // Over the drawn columns, so filtering out the pipeline's uploads takes
  // their fields with them rather than leaving rows reading „brak”.
  for (const rev of shownRevisions.value) {
    if (rev.data && typeof rev.data === "object") {
      for (const k of Object.keys(rev.data as Record<string, unknown>)) {
        if (!skippedChangeFields.has(k)) keys.add(k);
      }
    }
  }
  return Array.from(keys).sort((a, b) =>
    revisionFieldLabel(a).localeCompare(revisionFieldLabel(b), "pl"),
  );
});

/** A field's Polish name as a label: „Data urodzenia”, the way the history
 * list above writes the same fields on its lines and in its diffs. */
function fieldName(key: string): string {
  return capitaliseLabel(revisionFieldLabel(key));
}

/** A field's value as the diff prints it - a list as „PO, PiS”, a flag as
 * „tak” - or null when the revision has nothing there: no key, null, an empty
 * string or an empty list alike. Text with line breaks keeps them. */
function fieldText(rev: Record<string, unknown>, key: string): string | null {
  return renderFieldValue(getRevisionData(rev.data)[key]) || null;
}

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

/** The moment a revision was written, the way the history list above and the
 * queue print it, so a column can be found by its row's date. */
function formatDate(val: unknown) {
  const time = parseTime(val);
  return time ? formatMoment(time) : "—";
}

function revisionUser(rev: Record<string, unknown>): string | null {
  return typeof rev.update_user === "string" ? rev.update_user : null;
}

/** A proposal id reads `proposal_<nodeId>_<digest>`, and the node id is
 * already printed in the page header - repeating it once per column bought
 * nothing and cost the width. The digest is the part that tells two columns
 * apart, so it is what stays. Revisions written by the pipelines get a plain
 * 20-character Firestore id, which fits as it is. */
function shortRevisionId(id: unknown): string {
  const full = String(id);
  const prefix = `proposal_${nodeId}_`;
  return full.startsWith(prefix) ? `…${full.slice(prefix.length)}` : full;
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
 * to find. Compared as the cells print them, the way the diff compares:
 * `["PiS"]` and `{ 0: "PiS" }` are the same claim written two ways, and two
 * cells that both read „brak” are not a change whichever kind of nothing each
 * one stores. Everything is "changed" while nothing is approved yet - on a
 * brand new entry that is the truth. */
function differsFromApproved(rev: Record<string, unknown>, key: string) {
  const approved = approvedRevision.value;
  if (!approved) return true;
  if (rev.id === approved.id) return false;
  return fieldText(rev, key) !== fieldText(approved, key);
}
</script>

<style scoped>
/* The layout wraps every page in a `v-container.fill-height`, which Vuetify
   implements as a flex row - and a flex item does not shrink below its own
   content. So a table wide enough to scroll stretched the page instead, and
   `html { overflow-x: hidden }`, which Vuetify also sets, then clipped the
   right-hand revisions off with no way to reach them. `min-width: 0` hands the
   overflow back to the scroller below, which is where it belongs. The layout
   zeroes it on every page now as well; this one says so itself, because it is
   the page the table would break.

   The page sits in the site's one 1200px column like every other: it used to
   run the window's full width for the table's sake, which put its title 16px
   under the bar and 72px in, where every other page opens at the column's
   edge. The table scrolls sideways inside the column instead. Its width is
   the template's `w-100`. */
.revision-compare {
  min-width: 0;
}

/* Edge to edge on a phone (`k-bleed-xs`): a column is 300px at the least, and
   the gutters are what a 375px screen has to give it. Only while the table is
   drawn - its border-spacing is a gutter of its own, where the empty notes
   would sit against the screen's edge. */
.comparison-scroll {
  overflow: auto;
}
/* The cap is there only to keep a mouse's sideways scrollbar in reach: left to
   the page, it sat at the bottom of a table as tall as the field list, so on a
   node with thirty fields reaching it meant scrolling past everything it was
   there to move. So it applies only while the table really is wider than the
   column, and only with a fine pointer. A table that fits ends with its own
   bottom edge, rather than being cut off under the first rows; and on a phone
   it scrolls sideways at full height, with no inner vertical scroller to trap
   a swipe meant for the page. */
@media (hover: hover) and (pointer: fine) {
  .comparison-scroll--capped {
    max-height: calc(100vh - 16rem);
  }
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
  border-left: 1px solid var(--k-line);
  border-right: 1px solid var(--k-line);
  vertical-align: top;
}
/* Each column is one card: the hairline round it and the card radius at its
   two ends, with the fields inside ruled off at half the hairline. */
.card-header {
  border-top: 1px solid var(--k-line);
  border-top-left-radius: var(--k-r-card);
  border-top-right-radius: var(--k-r-card);
  padding-top: 20px;
}
.comparison-table tbody tr:last-child td {
  border-bottom: 1px solid var(--k-line);
  border-bottom-left-radius: var(--k-r-card);
  border-bottom-right-radius: var(--k-r-card);
  padding-bottom: 20px;
}
.comparison-table tbody tr td {
  border-top: 1px solid rgba(var(--v-border-color), 0.06);
}
/* A field's value with its own line breaks kept - a description's paragraphs -
   in the page's own type rather than the browser's monospace. */
.field-value pre {
  white-space: pre-wrap;
  font-family: inherit;
}
/* An id the shortening does not recognise still has to stay inside its column:
   underscores are not break opportunities, so one long token would stretch the
   table rather than wrap. Same for a list of sources, where a URL is equally
   unbreakable. */
.revision-id,
.field-value pre {
  overflow-wrap: anywhere;
}
.highlighted-revision {
  background: rgba(var(--v-theme-primary), 0.1) !important;
}
/* What this revision would change, so a reviewer reads the diff rather than
   the whole snapshot. The label in ink: Vuetify's `warning` as text is 2.4:1. */
.changed-field {
  background: rgba(var(--v-theme-warning), 0.12) !important;
}
.changed-field .field-label {
  color: rgb(var(--v-theme-ink-warning)) !important;
}
</style>

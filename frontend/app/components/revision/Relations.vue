<template>
  <section id="powiazania" class="relations" data-testid="relation-history">
    <AdminSectionHead
      title="Powiązania"
      :count="data ? data.total : undefined"
      info="Kandydatury, stanowiska i inne powiązania tej strony, każde z historią swoich rewizji. Najpierw te, które czekają: propozycje zmian i szkice, których nie ma jeszcze na stronie. Propozycję można tu zatwierdzić albo odrzucić, a szkic opublikować."
    >
      <v-chip-group
        v-if="variant === 'a' && data && data.relations.length > 0"
        v-model="filter"
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
          :disabled="option.count === 0 && filter !== option.value"
          :data-testid="`relation-filter-${option.value}`"
        >
          {{ option.title }} ({{ option.count }})
        </v-chip>
      </v-chip-group>
    </AdminSectionHead>

    <v-progress-linear
      v-if="loading && !data"
      indeterminate
      color="ink-sage"
      class="my-2"
      aria-label="Wczytuję powiązania"
    />
    <v-alert
      v-else-if="failed && !data"
      type="error"
      variant="tonal"
      density="compact"
    >
      Nie udało się wczytać powiązań.
    </v-alert>

    <template v-else-if="data">
      <p
        v-if="data.relations.length === 0"
        class="text-body-2 text-medium-emphasis"
      >
        Ta strona nie ma powiązań.
      </p>

      <template v-else>
        <p
          v-if="data.total > data.relations.length"
          class="text-caption text-medium-emphasis mb-2"
        >
          Pokazano {{ data.relations.length }} z {{ data.total }}: najpierw
          szkice, potem najnowsze.
        </p>

        <template v-for="group in groups" :key="group.key">
          <h3
            v-if="group.title"
            class="relations__group text-body-2 text-medium-emphasis"
          >
            {{ group.title }}
          </h3>
          <AdminRowList v-if="group.rows.length > 0">
            <AdminExpandRow
              v-for="relation in group.rows"
              :key="relation.id"
              :row-id="`powiazanie-${relation.id}`"
              :tone="tones[relation.state]"
              :dimmed="relation.state === 'removed'"
              :expanded="open.has(relation.id)"
              :data-relation-row="relation.id"
              :data-relation-state="relation.state"
              @update:expanded="(value: boolean) => setOpen(relation.id, value)"
            >
              <template #summary>
                <span class="rel-line">
                  <v-icon
                    class="flex-0-0 text-medium-emphasis"
                    size="small"
                    :icon="typeIcon(relation.type)"
                  />
                  <span class="rel-kind text-body-2" :title="kindOf(relation)">
                    {{ kindOf(relation) }}
                  </span>
                  <span
                    class="arow-grow rel-place text-body-2"
                    :title="placeOf(relation)"
                  >
                    {{ placeOf(relation) }}
                  </span>
                  <span
                    v-if="stateTag(relation)"
                    class="arow-tag rel-tag"
                    :class="stateTagClass[relation.state]"
                    data-relation-tag
                  >
                    {{ stateTag(relation) }}
                  </span>
                  <span
                    v-if="clashOf(relation)"
                    class="arow-tag rel-tag bg-surface-danger text-ink-danger"
                  >
                    dwa miejsca
                  </span>
                  <!-- Where the line breaks on a phone: what and its state
                       above, where and when below. Nothing on a wider screen. -->
                  <span class="rel-break" aria-hidden="true" />
                  <span
                    class="arow-fixed rel-when text-caption text-medium-emphasis"
                  >
                    {{ lastChange(relation) }}
                  </span>
                </span>
              </template>

              <template #meta>
                <AdminRowFact label="Stan">
                  {{ stateText(relation) }}
                </AdminRowFact>
                <AdminRowFact
                  :label="otherLabel(relation)"
                  class="rel-fact-wide"
                >
                  <NuxtLink
                    v-if="relation.other.path"
                    :to="relation.other.path"
                    class="text-ink-info"
                  >
                    {{ relation.other.name || relation.other.id }}
                  </NuxtLink>
                  <span v-else>{{
                    relation.other.name || relation.other.id
                  }}</span>
                  <span
                    v-if="!relation.other.published"
                    class="text-medium-emphasis"
                  >
                    (szkic)
                  </span>
                </AdminRowFact>
                <AdminRowFact
                  v-if="relation.committee"
                  label="Komitet"
                  class="rel-fact-wide"
                >
                  {{ relation.committee }}
                </AdminRowFact>
                <AdminRowFact v-if="relation.type === 'election'" label="Wynik">
                  {{ relation.elected ? "wybrany/a" : "nie podano" }}
                </AdminRowFact>
                <AdminRowFact v-else-if="periodOf(relation)" label="Okres">
                  {{ periodOf(relation) }}
                </AdminRowFact>
              </template>

              <v-alert
                v-if="clashOf(relation)"
                type="error"
                variant="tonal"
                density="compact"
                class="mb-3"
              >
                {{ clashOf(relation) }}
              </v-alert>

              <p
                v-if="relation.revisions.length === 0"
                class="text-body-2 text-medium-emphasis mb-0"
              >
                To powiązanie nie ma rewizji: zapisano je, zanim powstały.
              </p>
              <ol v-else class="rel-ledger" aria-label="Historia powiązania">
                <li
                  v-for="revision in ledgerOf(relation)"
                  :key="revision.id"
                  class="rel-rev"
                  :data-relation-revision="revision.id"
                >
                  <div class="rel-rev__line">
                    <v-icon
                      class="flex-0-0"
                      size="small"
                      :icon="revisionStatusIcons[revision.status]"
                      :color="proposalStatusLabels[revision.status].color"
                      role="img"
                      aria-hidden="false"
                      :aria-label="proposalStatusLabels[revision.status].label"
                      :title="proposalStatusLabels[revision.status].label"
                    />
                    <span class="rel-rev__when text-body-2">
                      {{ formatMoment(revision.updateTime) }}
                    </span>
                    <span class="rel-rev__who text-body-2 font-weight-bold">
                      {{ authorName(revision) }}
                    </span>
                    <span
                      class="arow-tag"
                      :class="
                        revision.automatic
                          ? 'bg-surface-muted text-ink-neutral'
                          : 'bg-surface-sage text-ink-sage'
                      "
                    >
                      {{ revision.automatic ? "Auto" : "Ręczna" }}
                    </span>
                    <span
                      class="rel-rev__status text-caption"
                      :class="`text-${proposalStatusLabels[revision.status].color}`"
                    >
                      {{ revisionState(relation, revision) }}
                    </span>
                  </div>
                  <div
                    v-if="revision.id !== relation.approvedRevisionId"
                    class="rel-rev__body"
                  >
                    <RevisionChangeCell
                      :proposal="revision"
                      :max="revision.changeCount"
                      wide
                    />
                    <RevisionReviewActions
                      v-if="isAdmin && waits(revision)"
                      class="mt-1"
                      :proposal="revision"
                      :offer-publish="false"
                      :reviewable="true"
                      :rejectable="true"
                      :loading="deciding === revision.id"
                      @approve="(options) => approve(revision, options)"
                      @reject="openReject(revision)"
                      @permalink="copyPermalink(revision)"
                    />
                  </div>
                </li>
              </ol>
              <v-btn
                v-if="relation.revisions.length > ledgerOf(relation).length"
                variant="text"
                size="small"
                class="mt-1"
                :data-testid="`relation-all-revisions-${relation.id}`"
                @click="fullLedger.add(relation.id)"
              >
                Pokaż wszystkie ({{ relation.revisions.length }})
              </v-btn>

              <template v-if="isAdmin && relation.state === 'draft'" #footer>
                <v-btn
                  color="ink-success"
                  variant="flat"
                  size="small"
                  :prepend-icon="mdiEarth"
                  :loading="publishing === relation.id"
                  :disabled="!relation.publishable"
                  :data-testid="`relation-publish-${relation.id}`"
                  @click="publish(relation)"
                >
                  Opublikuj powiązanie
                </v-btn>
                <span
                  v-if="!relation.publishable"
                  class="text-caption text-medium-emphasis"
                >
                  {{ blockedReason }}
                </span>
              </template>
            </AdminExpandRow>
          </AdminRowList>
        </template>

        <p
          v-if="variant === 'a' && shown.length === 0"
          class="text-body-2 text-medium-emphasis"
        >
          Żadne powiązanie nie czeka na decyzję.
        </p>
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
  </section>
</template>

<script setup lang="ts">
/** An entry's relations on its revision page, each with the history of its own
 * revisions, and the decisions waiting on them.
 *
 * The history above it lists the entry's revisions, and a relation's are
 * filed under the relation: a candidacy's office, its committee, a seat the
 * register closed. So a page could hold a draft candidacy and two proposals
 * while its history said nothing waited - Hubert Papaj's did, on 2026-10-17,
 * after a „Wyślij dane” run. Here every relation says where it stands: a change
 * waiting (amber rail), a draft not on the site (blue), settled (grey), removed
 * (greyed out).
 *
 * The decisions are the ones a revision gets anywhere else
 * (`RevisionReviewActions`), plus publishing a draft as it stands, which is
 * what /admin/krawedzie does for one relation at a time.
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  mdiBriefcaseOutline,
  mdiDomain,
  mdiEarth,
  mdiMapMarkerRadiusOutline,
  mdiNewspaperVariantOutline,
  mdiTagOutline,
  mdiVectorPolyline,
  mdiVoteOutline,
} from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { edgeTypeLabels } from "~/composables/edges";
import { polishCounting } from "~/composables/polish";
import { formatDaysAgo } from "~/utils/chartTheme";
import { revisionStatusIcons } from "~/utils/revisionStatus";
import type { RowTone } from "~/composables/rowTone";
import { proposalStatusLabels, type Proposal } from "~~/shared/proposals";
import { placeClashes, type Candidacy } from "~~/shared/twoPlaces";
import type {
  NodeRelationHistory,
  RelationHistory,
  RelationState,
  RelationSummary,
} from "~~/server/api/revisions/relations.get";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    /** The page's name, for the two-places warning. */
    nodeName?: string | null;
    /** Temporary, for the screenshots: `a` filters the list, `b` opens what
     * waits and lists the rest below it. */
    variant?: "a" | "b";
  }>(),
  { nodeName: null, variant: "a" },
);

const emit = defineEmits<{
  /** What waits, for the page's own signal at the top. */
  summary: [summary: RelationSummary];
}>();

const { isAdmin } = useAuthState();

const data = ref<NodeRelationHistory | null>(null);
const loading = ref(false);
const failed = ref(false);
const open = reactive(new Set<string>());

type Filter = "waiting" | "all";
/** „Czekają” even when nothing waits: a settled page then says so in one
 * line, rather than listing every relation it has above the comparison. */
const filter = ref<Filter>("waiting");

const waitsForDecision = (relation: RelationHistory) =>
  relation.state === "proposals" || relation.state === "draft";

const relations = computed(() => data.value?.relations ?? []);
const waitingRelations = computed(() =>
  relations.value.filter(waitsForDecision),
);

const filterOptions = computed(() => [
  {
    value: "waiting" as const,
    title: "Czekają",
    count: waitingRelations.value.length,
  },
  { value: "all" as const, title: "Wszystkie", count: relations.value.length },
]);

const shown = computed(() =>
  filter.value === "waiting" ? waitingRelations.value : relations.value,
);

/** What the list is drawn as: one filtered run (`a`), or the waiting run with
 * the settled ones under their own line (`b`). */
const groups = computed(() => {
  if (props.variant === "a") {
    return [{ key: "shown", title: null, rows: shown.value }];
  }
  const rest = relations.value.filter(
    (relation) => !waitsForDecision(relation),
  );
  return [
    { key: "waiting", title: null, rows: waitingRelations.value },
    {
      key: "rest",
      title:
        rest.length > 0 && waitingRelations.value.length > 0
          ? "Bez spraw do rozpatrzenia"
          : null,
      rows: rest,
    },
  ];
});

const tones: Record<RelationState, RowTone> = {
  proposals: "warning",
  draft: "info",
  settled: "neutral",
  removed: "danger",
};

const stateTagClass: Record<RelationState, string> = {
  proposals: "bg-surface-warning text-ink-warning",
  draft: "bg-surface-info text-ink-info",
  settled: "",
  removed: "bg-surface-danger text-ink-danger",
};

function stateTag(relation: RelationHistory): string | null {
  if (relation.state === "proposals") {
    return polishCounting(
      relation.waiting,
      "propozycja",
      "propozycje",
      "propozycji",
    );
  }
  if (relation.state === "draft") return "szkic";
  if (relation.state === "removed") return "usunięte";
  return null;
}

function stateText(relation: RelationHistory): string {
  if (relation.state === "removed") return "Usunięte";
  if (relation.state === "draft") return "Szkic, nie ma go na stronie";
  if (relation.state === "proposals")
    return `Na stronie, ${polishCounting(relation.waiting, "propozycja czeka", "propozycje czekają", "propozycji czeka")}`;
  return "Na stronie";
}

const ICONS: Record<string, string> = {
  election: mdiVoteOutline,
  employed: mdiBriefcaseOutline,
  owns: mdiDomain,
  seat: mdiMapMarkerRadiusOutline,
  mentions: mdiNewspaperVariantOutline,
  tagged: mdiTagOutline,
};

const typeIcon = (type: string) => ICONS[type] ?? mdiVectorPolyline;

/** What the relation is: „Kandydatura 2018”, „Rada Nadzorcza”. A candidacy
 * leads with its year, because a page's runs differ by little else. */
function kindOf(relation: RelationHistory): string {
  if (relation.type === "election") {
    const year = relation.startDate?.slice(0, 4);
    return year ? `Kandydatura ${year}` : "Kandydatura";
  }
  // An article's mention reads from the person's side: they are what it is
  // about, not what it says.
  if (relation.type === "mentions" && relation.direction === "incoming") {
    return "Wzmianka";
  }
  return relation.name || edgeTypeLabels[relation.type] || relation.type;
}

/** Where, or with whom: the office and the place for a candidacy - the office
 * is what tells a council run from a mayoral one in one town and one year -
 * and the page at the other end for the rest. */
function placeOf(relation: RelationHistory): string {
  const other = relation.other.name || relation.other.id;
  if (relation.type !== "election") return other;
  return [relation.position ?? "bez typu wyborów", other].join(" · ");
}

/** What the page at the other end is to this one, by what kind of page it
 * is: a candidacy's region and a job's company are where, an article is
 * where it was written about, a person is who. */
function otherLabel(relation: RelationHistory): string {
  switch (relation.other.type) {
    case "region":
    case "place":
      return "Gdzie";
    case "article":
      return "Artykuł";
    case "person":
      return "Kto";
    default:
      return "Druga strona";
  }
}

function periodOf(relation: RelationHistory): string | null {
  if (!relation.startDate && !relation.endDate) return null;
  return `${relation.startDate ?? "?"} - ${relation.endDate ?? "obecnie"}`;
}

/** When the relation last changed, by its newest revision. */
function lastChange(relation: RelationHistory): string {
  const newest = relation.revisions[0]?.updateTime;
  return newest ? formatDaysAgo(newest) : "";
}

/** A change somebody is waiting on: stored as pending, not a status read off
 * a revision older than review. See `waiting` on the endpoint. */
const waits = (revision: Proposal) =>
  revision.status === "pending" && !revision.statusDerived;

function revisionState(relation: RelationHistory, revision: Proposal): string {
  if (revision.id === relation.approvedRevisionId) return "Obecna wersja";
  return proposalStatusLabels[revision.status].label;
}

/** A draft candidacy that would put this person in a second place in one
 * election once it is live, said the way the publish dialog says it. */
const clashes = computed(() => {
  const candidacyOf = (relation: RelationHistory): Candidacy | undefined =>
    relation.type === "election" && relation.direction === "outgoing"
      ? {
          personId: props.nodeId,
          regionId: relation.other.id,
          startDate: relation.startDate,
          position: relation.position,
        }
      : undefined;
  const live = relations.value.filter(
    (relation) =>
      relation.state === "settled" || relation.state === "proposals",
  );
  const found = new Map<string, string>();
  for (const draft of relations.value.filter((r) => r.state === "draft")) {
    for (const clash of placeClashes([...live, draft], candidacyOf)) {
      if (!clash.rows.includes(draft)) continue;
      const election = clash.position
        ? `${clash.year} · ${clash.position}`
        : clash.year;
      const places = clash.rows.map((row) => row.other.name || row.other.id);
      found.set(
        draft.id,
        `Po publikacji strona pokaże tę osobę w dwóch miejscach w wyborach ${election}: ${places.join(" i ")}.`,
      );
    }
  }
  return found;
});

const clashOf = (relation: RelationHistory) =>
  clashes.value.get(relation.id) ?? null;

/** Why a draft cannot go live yet. Not naming the other end: a register name
 * runs to 200 characters, and the row above already gives it. */
const blockedReason = computed(() =>
  data.value?.nodePublished
    ? "Druga strona jest szkicem: najpierw opublikuj jej stronę."
    : "Najpierw opublikuj tę stronę: okno publikacji pozwala wybrać jej powiązania.",
);

/** How many of a relation's revisions its open row lists before „Pokaż
 * wszystkie”. A candidacy has two or three; one a contributor kept correcting
 * had a dozen, each with its diff and its buttons, and pushed every other
 * relation off the screen. */
const LEDGER_LIMIT = 6;

/** Relations whose whole history was asked for. */
const fullLedger = reactive(new Set<string>());

const ledgerOf = (relation: RelationHistory) =>
  fullLedger.has(relation.id)
    ? relation.revisions
    : relation.revisions.slice(0, LEDGER_LIMIT);

const setOpen = (id: string, value: boolean) => {
  if (value) open.add(id);
  else open.delete(id);
};

/** On arrival: the first relation that waits is opened (`a`), or every one
 * of them (`b`), because that is what the reviewer came down here for. */
function openWaiting() {
  if (props.variant === "b") {
    for (const relation of waitingRelations.value) open.add(relation.id);
    return;
  }
  const first = waitingRelations.value[0];
  if (first) open.add(first.id);
}

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    data.value = await authRequest<NodeRelationHistory>(
      "/api/revisions/relations",
      { method: "GET", query: { nodeId: props.nodeId } },
    );
    emit("summary", {
      total: data.value.total,
      drafts: data.value.drafts,
      withProposals: data.value.withProposals,
      proposals: data.value.proposals,
    });
  } catch (err) {
    console.error("Failed to load the relations", err);
    if (data.value) report(err);
    else failed.value = true;
  } finally {
    loading.value = false;
  }
}

// Client only, like the history above: the endpoint wants a bearer token.
onMounted(async () => {
  await load();
  openWaiting();
});

watch(
  () => props.nodeId,
  async () => {
    open.clear();
    fullLedger.clear();
    data.value = null;
    await load();
    openWaiting();
  },
);

defineExpose({ reload: load });

const MOMENT = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

function formatMoment(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "-"
    : MOMENT.format(date).replace(", ", " ");
}

/** As in the entry's history: the name, or „pipeline” for the ingest, whose
 * account is somebody's admin login. */
function authorName(revision: Proposal): string {
  if (revision.automatic) return "pipeline";
  return (
    revision.author?.displayName ||
    revision.author?.email ||
    revision.updateUser ||
    "Nieznany"
  );
}

const notice = ref("");
const noticeShown = ref(false);
const error = ref("");
const errorShown = ref(false);

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
const publishing = ref<string | null>(null);
const rejectOpen = ref(false);
const rejectTarget = ref<Proposal | null>(null);

async function approve(revision: Proposal, { publish }: { publish: boolean }) {
  deciding.value = revision.id;
  try {
    await authRequest("/api/revisions/approve", {
      body: { revision_id: revision.id, ...(publish ? { publish: true } : {}) },
    });
    announce(
      publish
        ? "Zatwierdzono zmianę i opublikowano powiązanie."
        : "Zatwierdzono zmianę powiązania.",
    );
    await load();
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
}

function openReject(revision: Proposal) {
  rejectTarget.value = revision;
  rejectOpen.value = true;
}

async function reject(reason: string) {
  const revision = rejectTarget.value;
  if (!revision) return;
  deciding.value = revision.id;
  try {
    await authRequest("/api/revisions/reject", {
      body: { revision_id: revision.id, reason },
    });
    rejectOpen.value = false;
    announce("Odrzucono zmianę powiązania.");
    await load();
  } catch (err) {
    report(err);
  } finally {
    deciding.value = null;
  }
}

/** As it stands: publishing approves the revision the relation already holds,
 * never a proposal it does not (see `publishEdgeInBatch`). */
async function publish(relation: RelationHistory) {
  publishing.value = relation.id;
  try {
    await authRequest("/api/edges/publish", {
      body: { edge_ids: [relation.id], published: true },
    });
    announce("Opublikowano powiązanie.");
    await load();
  } catch (err) {
    report(err);
  } finally {
    publishing.value = null;
  }
}

/** The review list's permalink, as the entry's history copies it. */
async function copyPermalink(revision: Proposal) {
  const link = `${window.location.origin}/admin/rewizje?rewizja=${encodeURIComponent(revision.id)}`;
  try {
    await navigator.clipboard.writeText(link);
    announce("Skopiowano link do propozycji.");
  } catch {
    error.value = link;
    errorShown.value = true;
  }
}
</script>

<style scoped>
/* The page is as wide as the window for the comparison table's sake; a list
   line stretched across 1900px puts its date a head-turn from its name. */
.relations {
  max-width: 1200px;
  /* The signal at the top links here, and the sticky bar would cover the
     section's head. */
  scroll-margin-top: 96px;
}

.relations__group {
  margin: 16px 0 8px;
  font-weight: 500;
}

.rel-line {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* A candidacy's „Kandydatura 2018” never gives way; a job title can run to
   „Przewodniczący Rady Nadzorczej, członek komitetu audytu i wynagrodzeń”,
   which ran off the end of a phone's line. */
.rel-kind {
  flex: 0 1 auto;
  max-width: 45%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rel-when {
  min-width: 72px;
  text-align: end;
}

/* The relation's own history: a ledger inside the row, one revision a line,
   newest first, ruled off from each other by the row's own hairline. */
.rel-ledger {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rel-rev + .rel-rev {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.rel-rev__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.rel-rev__when {
  font-variant-numeric: tabular-nums;
}

.rel-rev__who {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Beside the author, not at the row's far end: on a 1200px row that end is a
   head-turn from the date the word belongs to. */
.rel-rev__status {
  font-weight: 500;
}

/* Under the status icon's column, so the eye runs down the dates. */
.rel-rev__body {
  padding-inline-start: 28px;
}

.rel-break {
  display: none;
}

/* A company's register name can run to two hundred characters; in a 150px
   cell of the facts strip it stood twelve lines tall. Not on a phone, where
   the strip is one column and a span of two would add a second off-screen. */
@media (min-width: 600px) {
  .rel-fact-wide {
    grid-column: span 2;
  }
}

/* Two lines on a phone: the kind and its state, then the place and how long
   ago, indented under the kind. On one line the place was what gave way, and
   the place is what tells two runs in one year apart. */
@media (max-width: 599.98px) {
  .rel-line {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  /* Sized from nothing, so a long job title shares the first line with its
     icon and tag and gives way there, rather than taking a line of its own
     and pushing the tag onto a third. */
  .rel-kind {
    flex: 1 1 0;
    max-width: none;
  }

  .rel-tag {
    order: 1;
  }

  .rel-break {
    display: block;
    flex-basis: 100%;
    height: 0;
    order: 2;
  }

  /* Two lines at most: a company's register name ran to nine. The whole of
     it is in the open row's facts. */
  .rel-line .rel-place {
    order: 3;
    flex: 1 1 0;
    margin-inline-start: 28px;
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .rel-when {
    order: 4;
    min-width: 0;
  }

  .rel-rev__body {
    padding-inline-start: 0;
  }
}
</style>

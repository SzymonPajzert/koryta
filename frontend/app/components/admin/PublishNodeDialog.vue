<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card data-testid="publish-node-dialog">
      <v-card-title>Opublikuj stronę</v-card-title>
      <v-card-text>
        <p class="mb-4 text-body-2">
          Strona <strong>{{ nodeName || nodeId }}</strong> stanie się widoczna
          publicznie. Możesz przy okazji opublikować jej powiązania.
        </p>

        <v-alert
          v-if="autoApproveDate"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-testid="publish-auto-approve"
        >
          Ta strona nie ma zatwierdzonej rewizji, więc opublikujemy jej
          najnowszą wersję, z {{ autoApproveDate }}. Żeby pokazać inną,
          zatwierdź ją najpierw na
          <NuxtLink :to="`/admin/rewizje/${nodeId}`">liście rewizji</NuxtLink>.
        </v-alert>

        <div v-if="pending" class="text-center py-6">
          <v-progress-circular indeterminate />
        </div>

        <v-alert
          v-else-if="loadError"
          type="warning"
          variant="tonal"
          class="mb-2"
          data-testid="publish-relations-error"
        >
          Nie udało się wczytać powiązań. Możesz opublikować samą stronę.
        </v-alert>

        <p
          v-else-if="candidates.length === 0"
          class="text-body-2 text-medium-emphasis"
          data-testid="publish-no-relations"
        >
          Ta strona nie ma powiązań czekających na publikację.
        </p>

        <template v-else>
          <!-- Each election whose candidacies stand in two places, as a block
               of its own above the list: the places side by side, and how often
               the person stood in each otherwise, which is usually what tells
               the namesake's run from the career. A rail, like every other list
               somebody works through on this site. Picked by Szymon on
               2026-10-15 over one alert above the list with a chip on each of
               its rows. -->
          <section
            v-for="clash in clashes"
            :key="clashKey(clash)"
            class="place-clash mb-4"
            :data-testid="`publish-place-clash-${clashKey(clash)}`"
          >
            <!-- The why behind the site's „(i)”, which opens on a tap and
                 takes the keyboard's focus. It was a hover tooltip on a 12px
                 icon, out of reach of both a phone and a keyboard. -->
            <div class="place-clash__head">
              <v-icon :icon="mdiAlertOutline" size="small" />
              <span>Wybory {{ electionLabel(clash) }} – dwa miejsca naraz</span>
              <InfoBubble :label="`Wybory ${electionLabel(clash)}`">
                W jednych wyborach kandyduje się w jednym miejscu, więc co
                najmniej jedna z tych kandydatur należy do imiennika. Opublikuj
                tę, która pasuje do tej osoby – zwykle tę z miejsca, gdzie
                kandydowała też w innych latach – a drugą zostaw
                nieopublikowaną. „Zaznacz wszystkie” ich nie zaznacza.
              </InfoBubble>
            </div>
            <v-list density="compact" class="py-0 bg-transparent">
              <v-list-item
                v-for="relation in clash.rows"
                :key="relation.id"
                class="publish-relation"
                :class="{
                  'text-disabled': !relation.published && !relation.publishable,
                }"
                :data-testid="`publish-relation-${relation.id}`"
              >
                <template #prepend>
                  <v-checkbox-btn
                    :model-value="
                      relation.published || selected.includes(relation.id)
                    "
                    :disabled="relation.published || !relation.publishable"
                    :data-testid="`publish-relation-check-${relation.id}`"
                    @update:model-value="toggle(relation.id)"
                  />
                </template>
                <v-list-item-title class="publish-relation__wrap">
                  {{ relation.otherName || relation.otherId }}
                </v-list-item-title>
                <v-list-item-subtitle class="publish-relation__wrap">
                  {{ placeHint(clash, relation.otherId) }}
                </v-list-item-subtitle>
                <v-list-item-subtitle
                  v-if="relation.published"
                  class="publish-relation__state"
                >
                  już opublikowana
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </section>

          <div class="d-flex align-center mb-2">
            <div class="text-subtitle-2">
              {{ clashes.length > 0 ? "Pozostałe powiązania" : "Powiązania" }}
              ({{ listedSelectedCount }}/{{ listedSelectableCount }})
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              :disabled="bulkIds.length === 0"
              data-testid="publish-select-all"
              @click="toggleAll"
            >
              {{ allSelected ? "Odznacz wszystkie" : "Zaznacz wszystkie" }}
            </v-btn>
          </div>

          <v-list density="compact" class="py-0">
            <v-list-item
              v-for="relation in listed"
              :key="relation.id"
              class="publish-relation"
              :class="{ 'text-disabled': !relation.publishable }"
              :data-testid="`publish-relation-${relation.id}`"
            >
              <template #prepend>
                <v-checkbox-btn
                  :model-value="selected.includes(relation.id)"
                  :disabled="!relation.publishable"
                  :data-testid="`publish-relation-check-${relation.id}`"
                  @update:model-value="toggle(relation.id)"
                />
              </template>
              <v-list-item-title class="publish-relation__wrap">
                {{ relationLabel(relation) }}
              </v-list-item-title>
              <v-list-item-subtitle class="publish-relation__wrap">
                {{ relation.direction === "outgoing" ? "→" : "←" }}
                {{ relation.otherName || relation.otherId }}
              </v-list-item-subtitle>
              <!-- Why a row is greyed, and what ticking it also approves, on a
                   line of its own that wraps rather than ellipsises. Vuetify
                   clamps a subtitle to one line, and the page it names is
                   usually a long capitalised KRS name, so put after it the
                   reason was cut off on a phone and often on a computer too -
                   a greyed checkbox with no reason again. It was an icon at
                   the row's end whose reason only a hover could open. -->
              <v-list-item-subtitle
                v-if="
                  !relation.publishable ||
                  relation.hasPendingRevision ||
                  relation.revisionToApprove
                "
                class="publish-relation__state"
              >
                {{ relationState(relation) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </template>

        <!-- What this click would put live, as the night's check will count it:
             the candidacies already published and the ones ticked. Shown by
             the button rather than at the top, because it is about the choice
             just made, and it does not stop the click - the reviewer may know
             better than a rule about TERYT prefixes. -->
        <v-alert
          v-if="clashesAfterPublish.length > 0"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          data-testid="publish-clash-after"
        >
          <span
            v-for="clash in clashesAfterPublish"
            :key="clashKey(clash)"
            class="d-block"
          >
            Po publikacji strona pokaże tę osobę w dwóch miejscach w wyborach
            {{ electionLabel(clash) }}: {{ placeNames(clash) }}.
          </span>
          Odznacz kandydaturę, która do niej nie należy.
        </v-alert>

        <v-alert
          v-if="relationsFailed"
          type="error"
          variant="tonal"
          class="mt-4"
          data-testid="publish-relations-failed"
        >
          <p class="mb-1">
            <strong>Strona została opublikowana, ale powiązania nie.</strong>
            Żadne z zaznaczonych powiązań nie trafiło na stronę - są publikowane
            razem albo wcale.
          </p>
          <p class="mb-1 text-body-2">{{ relationsFailed }}</p>
          <p class="mb-0 text-body-2">
            Spróbuj ponownie tutaj albo opublikuj je w
            <NuxtLink to="/admin/krawedzie">kolejce powiązań</NuxtLink> – strona
            jest już widoczna publicznie, więc ten dialog więcej się nie
            otworzy.
          </p>
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          color="success"
          variant="tonal"
          :loading="saving"
          data-testid="publish-confirm"
          @click="confirm()"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiAlertOutline } from "@mdi/js";
// Imported rather than auto-imported, as in PageSection: a plain `mount` in a
// unit test has no resolver, and an unresolved bubble renders as nothing.
import InfoBubble from "../InfoBubble.vue";
import { authRequest } from "~/composables/auth";
import { formatMoment } from "~/utils/moment";
import { edgeTypeLabels, relationsPlural } from "~/composables/edges";
import {
  latestPublishableRevision,
  normalizeUpdateTime,
} from "~~/shared/revisions";
import {
  placeClashes,
  yearsInPlace,
  type Candidacy,
  type PlaceClash,
} from "~~/shared/twoPlaces";
import type {
  NodeRelation,
  NodeRelations,
} from "~~/server/api/edges/byNode.get";

const props = defineProps<{
  modelValue: boolean;
  nodeId: string;
  nodeName?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** The node went live, along with this many relations - and, where it had no
   * approved revision, by way of approving the one named here. */
  published: [payload: { relations: number; approvedRevisionId?: string }];
  /** `nodePublished` is the whole reason this carries a payload rather than the
   * error alone: the two calls are not one transaction, so a refusal on the
   * second leaves the page live with none of its relations. The page has to be
   * able to say that, and to reload the toggle it now disagrees with. */
  failed: [payload: { error: unknown; nodePublished: boolean }];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const relations = ref<NodeRelation[]>([]);
/** When the page has nothing approved: the date of the version publishing will
 * approve on the reviewer's behalf. Worked out here rather than passed in, so
 * that every screen offering this dialog says it - the badge on a person's own
 * page has no revision list of its own to consult. */
const autoApproveDate = ref<string | null>(null);
const selected = ref<string[]>([]);
const pending = ref(false);
const saving = ref(false);
const loadError = ref(false);
/** Set when the page went live but its relations were refused - the one
 * outcome the reviewer cannot see for themselves, because the dialog is still
 * open in front of the page it already changed. */
const relationsFailed = ref<string | null>(null);

/** Only what a reviewer could still act on. An already published relation has
 * nothing to decide, and listing it would bury the ones that do. */
const candidates = computed(() =>
  relations.value.filter((relation) => !relation.published),
);

/** The ones that may actually go live. The rest are shown, greyed, so the
 * reviewer can see *why* a relation is not on offer rather than wondering
 * where it went. */
const selectableIds = computed(() =>
  candidates.value.filter((r) => r.publishable).map((r) => r.id),
);

/** A relation as the two-places rule reads it: one of this page's own
 * candidacies, which run from the person to the place. */
function candidacyOf(relation: NodeRelation): Candidacy | undefined {
  if (relation.type !== "election" || relation.direction !== "outgoing") {
    return undefined;
  }
  return {
    personId: props.nodeId,
    regionId: relation.otherId,
    startDate: relation.startDate,
    position: relation.position,
  };
}

/** Elections in which this page's candidacies stand in two places, published
 * or not, newest first like the list. Every PKW record nothing contradicts is
 * sent to the page since 2026-10-07, so these are usually a namesake's runs
 * waiting to be rejected - and ticking every relation, which is how both
 * namesakes that went live (Wiśniewski 10-07, Kowalski 10-14) got there,
 * publishes them. */
const clashes = computed(() =>
  placeClashes(relations.value, candidacyOf).toSorted((a, b) =>
    b.year.localeCompare(a.year),
  ),
);

/** Each clashing relation's clash, by relation id. */
const clashOf = computed(() => {
  const byRelation = new Map<string, PlaceClash<NodeRelation>>();
  for (const clash of clashes.value) {
    for (const relation of clash.rows) byRelation.set(relation.id, clash);
  }
  return byRelation;
});

/** The clashes this click would put live: among the candidacies already
 * published and the ones ticked. These are what
 * `test_nobody_stands_in_two_places_at_once` counts, and one more than it
 * knows of holds the night's people upload. */
const clashesAfterPublish = computed(() =>
  placeClashes(
    relations.value.filter(
      (relation) => relation.published || selected.value.includes(relation.id),
    ),
    candidacyOf,
  ),
);

/** The rows of the main list: everything but the clashing candidacies, which
 * have blocks of their own above it. */
const listed = computed(() =>
  candidates.value.filter((relation) => !clashOf.value.has(relation.id)),
);

const listedSelectableCount = computed(
  () => listed.value.filter((relation) => relation.publishable).length,
);

const listedSelectedCount = computed(
  () =>
    listed.value.filter((relation) => selected.value.includes(relation.id))
      .length,
);

/** What „Zaznacz wszystkie” ticks: everything that may go live but the
 * candidacies of a clash, which the reviewer has to pick one by one. */
const bulkIds = computed(() =>
  selectableIds.value.filter((id) => !clashOf.value.has(id)),
);

const allSelected = computed(
  () =>
    bulkIds.value.length > 0 &&
    bulkIds.value.every((id) => selected.value.includes(id)),
);

const confirmLabel = computed(() =>
  selected.value.length > 0
    ? `Opublikuj stronę i ${selected.value.length} ${relationsPlural(selected.value.length)}`
    : "Opublikuj tylko stronę",
);

/** Stamped the way `/admin/rewizje/[id]` heads its columns, so a reviewer who
 * goes looking for the version named here can find the column it is. */
function revisionDate(updateTime: unknown): string {
  const iso = normalizeUpdateTime(updateTime);
  if (!iso) return "nieznanej daty";
  return formatMoment(iso);
}

/** What a row is. A candidacy says which election as well - „kandydatura ·
 * 2002 · Samorząd" - because every one of them is named „kandydatura", and a
 * page's seven runs would otherwise read as seven identical rows. In the title
 * rather than after the place: a phone cuts the subtitle short. */
function relationLabel(relation: NodeRelation): string {
  const label = relation.name || edgeTypeLabels[relation.type] || relation.type;
  if (relation.type !== "election") return label;
  return [label, relation.startDate?.slice(0, 4), relation.position]
    .filter(Boolean)
    .join(" · ");
}

/** Why a row cannot be ticked, and what ticking it also does, as the words
 * on its own line under the page it names: „druga strona nieopublikowana”,
 * then whether a proposal is still waiting or the newest revision is what
 * goes live with it. */
function relationState(relation: NodeRelation): string {
  const clauses: string[] = [];
  if (!relation.publishable) clauses.push("druga strona nieopublikowana");
  if (relation.hasPendingRevision) {
    clauses.push("propozycja czeka na zatwierdzenie");
  } else if (relation.revisionToApprove) {
    clauses.push("zostanie zatwierdzona najnowsza rewizja");
  }
  return clauses.join(" · ");
}

function clashKey(clash: PlaceClash<NodeRelation>): string {
  return `${clash.year}-${clash.position ?? ""}`;
}

function electionLabel(clash: PlaceClash<NodeRelation>): string {
  return clash.position ? `${clash.year} · ${clash.position}` : clash.year;
}

/** The years, besides the clash's own, in which the person stood in this
 * place or one containing it - the hint for which run is theirs. */
function placeHint(clash: PlaceClash<NodeRelation>, regionId: string): string {
  const others = yearsInPlace(
    relations.value,
    candidacyOf,
    props.nodeId,
    regionId,
  ).filter((year) => year !== clash.year);
  if (others.length === 0) return `tu tylko w ${clash.year}`;
  return `tu też w ${polishList(others)}`;
}

/** The places a clash puts the person in, each once, in the order its rows
 * came - „Powiat kozienicki i Powiat gnieźnieński". */
function placeNames(clash: PlaceClash<NodeRelation>): string {
  return polishList(
    Array.from(
      new Set(
        clash.rows.map((relation) => relation.otherName || relation.otherId),
      ),
    ),
  );
}

/** „a, b i c". */
function polishList(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} i ${items.at(-1)}`;
}

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}

/** Ticks everything but a clash's candidacies, keeping any of those the
 * reviewer already picked; unticks everything. */
function toggleAll() {
  selected.value = allSelected.value
    ? []
    : Array.from(new Set([...selected.value, ...bulkIds.value]));
}

async function load() {
  pending.value = true;
  loadError.value = false;
  relationsFailed.value = null;
  selected.value = [];
  autoApproveDate.value = null;
  // Not fatal either, and separately awaited for that reason: which version is
  // about to go live is worth saying, but not worth refusing to publish over.
  void loadAutoApprove();
  try {
    const data = await authRequest<NodeRelations>("/api/edges/byNode", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
    relations.value = data.relations;
  } catch (error) {
    // Not fatal: publishing the page on its own is still the thing the admin
    // came here to do, so the dialog degrades to that rather than closing.
    console.error("Failed to load relations", error);
    relations.value = [];
    loadError.value = true;
  } finally {
    pending.value = false;
  }
}

/** The same choice `/api/nodes/publish` will make, read from the same place
 * `/admin/rewizje/[id]` reads its table from. */
async function loadAutoApprove() {
  try {
    const data = await authRequest<{
      revisions: (Record<string, unknown> & { id: string })[];
      approvedRevisionId: string | null;
    }>("/api/revisions/byNode", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
    if (data.approvedRevisionId) return;
    const revision = latestPublishableRevision(data.revisions);
    if (!revision) return;
    autoApproveDate.value = revisionDate(revision.update_time);
  } catch (error) {
    // The publication itself will still say what it did, so a failure here
    // costs a sentence rather than the action.
    console.error("Failed to read revisions", error);
  }
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) load();
  },
);

/** The node first, then its relations - publishing an edge is refused while
 * either of its pages is still a draft, and this node is one of them. */
async function confirm() {
  saving.value = true;
  relationsFailed.value = null;
  let nodePublished = false;
  let approvedRevisionId: string | undefined;
  try {
    const result = await authRequest<{ approvedRevisionId?: string | null }>(
      "/api/nodes/publish",
      { body: { node_id: props.nodeId, published: true } },
    );
    nodePublished = true;
    approvedRevisionId = result.approvedRevisionId ?? undefined;
    if (selected.value.length > 0) {
      // /api/edges/publish refuses the batch as a whole, so one relation whose
      // other end went back to being a draft between the dialog opening and
      // this click takes every other tick down with it - while the page above
      // is already live. Saying so is the difference between a reviewer who
      // retries and one who walks away believing the whole thing landed.
      await authRequest("/api/edges/publish", {
        body: { edge_ids: selected.value, published: true },
      });
    }
    emit("published", {
      relations: selected.value.length,
      approvedRevisionId,
    });
    open.value = false;
  } catch (error) {
    if (nodePublished && selected.value.length > 0) {
      relationsFailed.value = errorMessage(error);
    }
    emit("failed", { error, nodePublished });
  } finally {
    saving.value = false;
  }
}

/** The server's own words where it gave any - ofetch parks the parsed body on
 * `data`, and that is where the Polish explanation of a refusal lives. */
function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  return (
    data?.message ||
    (error instanceof Error ? error.message : "") ||
    "Nieznany błąd."
  );
}
</script>

<style scoped>
/* The rail every list somebody works through carries on this site
   (.interface-design/system.md, `AdminExpandRow`): the row's colour down its
   left edge and a tinted head - here the warning pair from shared/colors.ts. */
.place-clash {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--k-line);
  border-radius: var(--k-r-card);
  box-shadow: inset 4px 0 0 rgb(var(--v-theme-ink-warning));
  overflow: hidden;
}

.place-clash__head {
  align-items: center;
  background: rgb(var(--v-theme-surface-warning));
  color: rgb(var(--v-theme-ink-warning));
  display: flex;
  font-size: var(--k-ui-size);
  font-weight: 600;
  gap: 6px;
  padding: 6px 12px 6px 16px;
}

.place-clash :deep(.v-list) {
  padding-left: 4px !important;
}

/* One relation is one block: more air between two relations than between the
   lines of one, so a role, its page and its state read as belonging together. */
.publish-relation {
  padding-block: 6px;
}

/* The checkbox beside the role it ticks, not beside the middle of a row that
   now runs three to five lines: Vuetify centres the prepend on the whole row.
   Pulled up by half a line, so the 40px control's centre sits on the first
   line of the 14px/1.45 title (about 20px tall) rather than 10px under it. */
.publish-relation :deep(.v-list-item__prepend) {
  align-self: start;
  margin-top: -10px;
}

/* That pull reaches 4px above the row. A `v-list` scrolls its own overflow, so
   on the first row it would shave the top off the control's hover and focus
   circle; 4px more there keeps the whole 40px inside the list. */
.publish-relation:first-child {
  padding-top: 10px;
}

/* A row's state - why it is greyed, what ticking it approves - wraps instead
   of ellipsising. Vuetify clamps every subtitle to one line with a two-class
   rule (`.v-list-item--one-line .v-list-item-subtitle`), so this needs a
   second class to win on specificity rather than on the order the sheets
   happen to load in. It is a 12px meta line in the same ink, a step under
   the page it names, so the two stop reading as one sentence. */
.v-list-item-subtitle.publish-relation__state {
  -webkit-line-clamp: unset;
  font-size: var(--k-meta-size);
  margin-top: 2px;
}

/* The relation itself - the role about to be published, the page at its
   other end - wraps too, by the same two-class rule. A role like „Zastępca
   Przewodniczącego Rady Nadzorczej ds. …” or an article named by its BIP url
   was cut to a line with no title to hover, so what the tick would put live
   could not be read before ticking it. */
.v-list-item-title.publish-relation__wrap {
  white-space: normal;
  overflow-wrap: anywhere;
}

.v-list-item-subtitle.publish-relation__wrap {
  -webkit-line-clamp: unset;
  overflow-wrap: anywhere;
}
</style>

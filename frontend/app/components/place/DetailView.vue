<template>
  <div style="width: 100%">
    <v-card
      v-if="status !== 'success' || company?.type !== 'place'"
      class="mb-4"
      :title="user ? 'Nie udało się wczytać strony' : 'Dostęp zastrzeżony'"
    >
      <v-card-text v-if="!user" class="pt-0">
        <p class="mb-4">
          Ta strona nie została znaleziona lub oczekuje na zatwierdzenie.
          Niezaakceptowane strony są widoczne tylko dla zalogowanych
          użytkowników.
        </p>
        <v-btn color="primary" variant="flat" @click="handleLoginRedirect()">
          Zaloguj się
        </v-btn>
      </v-card-text>
      <v-card-text v-else class="pt-0">
        <v-alert type="warning" variant="tonal" class="mb-4">
          <p class="mb-2">Strona nie mogła zostać załadowana.</p>
          <!-- 14px, as on a person's page: a sentence is prose, and prose is
               never 12px. -->
          <p class="text-body-2">
            Prawdopodobnie instytucja nie istnieje, została usunięta lub nie
            masz do niej dostępu.
          </p>
        </v-alert>
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="mdiRefresh"
          @click="refreshNode()"
        >
          Odśwież stronę
        </v-btn>
        <v-btn
          variant="tonal"
          to="/"
          :prepend-icon="mdiHome"
          class="ml-2"
          text="Strona główna"
        />
      </v-card-text>
    </v-card>

    <!-- The page sits on the page: no card around it, so the name, the
         sections and the lists share one left edge with the bar above, and a
         phone gives them its full width. With the card gone, `k-sections`
         is what spaces them: one gap above each block, as on a person's page
         (assets/css/edges.css). -->
    <div v-else class="w-100 k-sections">
      <v-alert v-if="revisionId" type="info" variant="tonal">
        Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
        <br />
        <nuxt-link :to="`/admin/rewizje/${nodeId}?revisionId=${revisionId}`">
          Zobacz historię zmian </nuxt-link
        >.
      </v-alert>

      <!-- The people first. What this institution is, then who sits in it
           now and everyone who held a post here before, then one line on
           what the register does not tell us, then who owns it and what it
           owns, and only then the handovers and the rest. The owners came
           back above the handovers with Szymon's pick of 2026-10-23: under
           them they stood 24,000px down a long company's phone page. A
           section with nothing in it is not drawn at all: what it would have
           said goes into that one line.

           Each block straight in `k-sections`, as on a person's page, so a
           company's sections stand the same 40px apart as a person's (32 on
           a phone), the first of them too: it stood 24px under the header's
           rule here, where a person's stands 40. -->
      <CardCompanySummary
        :key="nodeId"
        :company="company"
        :location="location"
        @submitted="proposals?.refresh()"
        @published="refreshNode()"
      >
        <!-- The page's links ride in the header's own row of buttons, after
             the ones that act on the page itself. -->
        <!-- `ButtonIconAction`, as the person page's tools: labelled in the
             row on a computer, a 40px square with its label as a tooltip on
             a phone. -->
        <template #actions>
          <ButtonIconAction
            :icon="mdiFormatListBulleted"
            :to="`/eksploruj/tabela?place=${nodeId}`"
            label="Eksploruj powiązania"
          />
          <ButtonIconAction
            :icon="mdiGraphOutline"
            :to="`/graf?miejsce=${nodeId}`"
            label="Graf powiązań"
          />
        </template>
      </CardCompanySummary>

      <!-- Renders nothing until the reader has proposed something for this
           company, so a page nobody has touched looks exactly as it did. It
           belongs to the header, and keeps its own `mt-4` under it. -->
      <RevisionNodeProposals ref="proposals" :node-id="nodeId" />

      <!-- Three parts of one component, off the one request below: who
           holds a post now, what the page cannot show, and who took over
           from whom.

           Today's board is drawn once, as these cards: the history below
           leaves their posts out (`historyEdges`). So each card carries
           what its row there had - the draft badge, and the sources, the
           correction and the bin - off the same permissions and into the
           same dialogs as the history's rows. -->
      <SuccessionCompanyChanges
        :key="`current-${nodeId}`"
        part="current"
        :company-name="company.name"
        :data="successions"
        :status="successionsStatus"
        :edges
        :can-cite="canAddRelations"
        :can-correct="canEditRelations"
        :can-remove="canRemoveRelations"
        :subject-published="subjectPublished"
        @sources="openSources"
        @edit="openEdit"
        @remove="openRemove"
        @published="refreshEdges()"
      />

      <!-- Opens on „Zakończone” once the board's cards are drawn: what is
           held today is in them. Its caption counts everybody all the same,
           the board included (Szymon, 2026-10-23): `caption-edges`. -->
      <CardEmploymentHistory
        :edges="historyEdges"
        :caption-edges="historyAll"
        bleed
        ledger
        people-by-period
        class="company-history"
        :company="company"
        :can-add="canAddRelations"
        :can-cite="canAddRelations"
        :can-correct="canEditRelations"
        :can-remove="canRemoveRelations"
        :subject-published="subjectPublished"
        @add="openAdd(['employed'], 'Dodaj osobę pracującą tutaj')"
        @sources="openSources"
        @edit="openEdit"
        @remove="openRemove"
        @published="refreshEdges()"
      />

      <SuccessionCompanyChanges
        :key="`absent-${nodeId}`"
        part="absent"
        :company-name="company.name"
        :data="successions"
        :status="successionsStatus"
        class="company-absent"
      />

      <!-- Each with its count beside the head. A long list of subsidiaries
           folds after twelve, behind „Pokaż wszystkie”, for a reader who is
           not signed in. Signed in, it is whole: the contributor's page
           comes first, and an admin's rows carry the controls nothing may
           put a click away (Szymon, 2026-10-23). -->
      <CardConnectionList
        :edges="owners"
        title="Właściciele"
        :count-nouns="['podmiot', 'podmioty', 'podmiotów']"
        empty-text="Nie znamy właścicieli."
        :can-add="canAddRelations"
        :can-remove="canRemoveRelations"
        :subject-published="subjectPublished"
        add-testid="owners"
        @add="openAdd(['owns_parent'], 'Dodaj właściciela')"
        @remove="openRemove"
        @published="refreshEdges()"
      />
      <CardConnectionList
        :edges="subsidiaries"
        title="Spółki zależne"
        :count-nouns="['spółka', 'spółki', 'spółek']"
        empty-text="Nie znamy spółek zależnych."
        :fold-after="user ? undefined : SUBSIDIARIES_SHOWN"
        :can-add="canAddRelations"
        :can-remove="canRemoveRelations"
        :subject-published="subjectPublished"
        add-testid="subsidiaries"
        @add="openAdd(['owns_child'], 'Dodaj spółkę zależną')"
        @remove="openRemove"
        @published="refreshEdges()"
      />

      <SuccessionCompanyChanges
        :key="`relay-${nodeId}`"
        part="relay"
        :company-name="company.name"
        :data="successions"
        :status="successionsStatus"
      />

      <!-- Headed like every other section, as on a person's page, and not
           drawn for a company with no relations, whose graph is the one
           node. On a phone the head stands over the button that opens it.

           One hop by default, unlike a person's page: a company's own
           relations are already a board's worth of names, and the second
           ring is every other seat each of them holds. It is a click away
           in the bar above the canvas for a reader who wants it. -->
      <PageSection
        v-if="edges.length > 0"
        title="Graf powiązań"
        data-testid="entity-graph"
      >
        <LazyGraphContainer
          v-if="!smAndDown || showGraph"
          :key="nodeId"
          class="k-bleed-xs"
          :focus-node-id="nodeId"
          :max-depth="1"
        />
        <!-- Flat, not tonal: tonal draws the label in the theme's pale sage
             on a wash of the same sage, which is 1.73:1. Flat is black on
             sage. -->
        <v-btn
          v-else
          color="primary"
          variant="flat"
          :prepend-icon="mdiGraphOutline"
          text="Pokaż graf powiązań"
          @click="showGraph = true"
        />
      </PageSection>

      <!-- The press on this company: the same section a person's page
           carries, off the same endpoint. `mentions` is declared for both. -->
      <MentionArticleList :node-id="nodeId" />

      <!-- `id`: the header's „Notatki” scrolls here. -->
      <NoteEditor id="notatki" :node-id="nodeId" node-type="place" />

      <CommentsSection v-if="user" :node-id="nodeId" />

      <FormAddRelationDialog
        v-model="addRelationOpen"
        :node-id="nodeId"
        node-type="place"
        :node-name="company.name"
        :types="addRelationTypes"
        :title="addRelationTitle"
        @added="refreshRelations()"
      />

      <FormEdgeSourcesDialog
        v-if="sourcesEdge?.id"
        v-model="sourcesOpen"
        :edge-id="sourcesEdge.id"
        :edge-label="sourcesLabel"
        @changed="refreshEdges()"
      />

      <DialogEditRelationHost
        v-model="editOpen"
        v-model:outcome="editedOutcome"
        :edge="editEdge"
        :label="editLabel"
        :can-apply="canApplyEdits"
        @saved="onEdgeEdited"
      />

      <DialogRemoveEdgeHost
        v-model="removeOpen"
        v-model:shown="removedShown"
        :edge="removeEdge"
        :label="removeLabel"
        @removed="onEdgeRemoved()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/** A company's own page.
 *
 * It has one because `EntityDetailView` had grown to serve person, place and
 * region from one template with a hardcoded region special case, a mis-bound
 * `v-else` that rendered a place's relations twice, and a place branch nothing
 * could reach - `generateNodeUrl` sent every company to the table filtered to
 * it. `article/DetailView.vue` is the precedent for splitting one out.
 *
 * What the page is for, in order: what this institution is, who sits in it now,
 * and who they took over from. The last of those is the reason the page came
 * back; the rest of it - owners, subsidiaries, the full relation history, the
 * graph, notes and comments - is what the unreachable branch already had.
 */
import {
  mdiFormatListBulleted,
  mdiGraphOutline,
  mdiHome,
  mdiRefresh,
} from "@mdi/js";
import { useDisplay } from "vuetify";
import { onePerNode, useEdges, type EdgeNode } from "~/composables/edges";
import { edgeSentence } from "~/utils/edgeSentence";
import { useEdgeRemoval } from "~/composables/edgeRemoval";
import { useEdgeEditing } from "~/composables/edgeEditing";
import {
  entityDescription,
  entityOgType,
  SOCIAL_CARD,
} from "~/composables/entitySeo";
import { useAuthState, authFetch, authRequest } from "@/composables/auth";
import { boardEdgeIds, useCompanySuccessions } from "~/composables/successions";
import type { Company, Revision } from "~~/shared/model";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import FormAddRelationDialog from "~/components/form/AddRelationDialog.vue";
import type { edgeTypeExt } from "~/composables/useEdgeTypes";

const props = defineProps<{ nodeId: string }>();
const nodeId = props.nodeId;

const route = useRoute();
const router = useRouter();
const { user } = useAuthState();
const { smAndDown } = useDisplay();

/** Who holds a post here now and who took over from whom, asked once for the
 * three places the page draws it. Started before the node is awaited, so the
 * two requests run side by side, and not awaited itself: Nuxt still settles it
 * before it serialises the page. */
const {
  data: successions,
  status: successionsStatus,
  refresh: refreshSuccessions,
} = useCompanySuccessions(nodeId);

/** How many subsidiaries a reader who is not signed in sees before „Pokaż
 * wszystkie”: Orlen lists about eighty (Szymon, 2026-10-23). */
const SUBSIDIARIES_SHOWN = 12;

// The graph is the heaviest thing on the page and a phone shows one node at a
// time anyway, so a narrow screen asks for it rather than being given it.
const showGraph = ref(false);

function handleLoginRedirect() {
  router.push({ path: "/login", query: { redirect: route.fullPath } });
}

const {
  data: response,
  status,
  refresh: refreshNode,
} = await authFetch<{ node: Company }>(`/api/nodes/${nodeId}`);

// A reader who signs in on a draft page should see it without reloading.
watch(
  user,
  (signedIn) => {
    if (signedIn && status.value === "error") refreshNode();
  },
  { immediate: true },
);

/** The card listing what this reader has proposed here. Refreshed by hand
 * after a submission rather than by a watcher: the proposal is made inside the
 * summary card, and the card has no other reason to know about it. */
const proposals = ref<{ refresh: () => void } | null>(null);

const revisionId = computed(() => route.query.revisionId as string | undefined);

// A proposed change laid over the page, for a signed in reader who followed a
// link to it. In the browser only and with the token: a revision is a draft,
// party and all, that /api/revisions/[id] gives nobody else, and the server's
// render is always anonymous - it merged any revision anybody named into the
// page it served them.
const { data: revisionResponse } = await useAsyncData<Revision | null>(
  `revision-${route.query.revisionId || "none"}`,
  async () => {
    if (!revisionId.value || !user.value) return null;
    return authRequest<Revision>(`/api/revisions/${revisionId.value}`, {
      method: "GET",
    });
  },
  { watch: [revisionId, user], server: false },
);

/** The company as the reader is looking at it, which is the stored node unless
 * they followed a link to a proposed change. */
const company = computed<Company | undefined>(() => {
  const node = response.value?.node;
  if (revisionId.value && revisionResponse.value?.data) {
    return { ...node, ...revisionResponse.value.data } as unknown as Company;
  }
  return node;
});

/** Whether the page itself is live, which is what decides whether one of its
 * relations may be - see the same computed on `EntityDetailView`. */
const subjectPublished = computed(() => company.value?.published === true);

const { sources, targets, refresh: refreshEdges } = await useEdges(nodeId);
const edges = computed(() => [...sources.value, ...targets.value]);
// Shareholders, and the seat while the migration is still running - once no
// region->place `owns` edge is left, `seat` here can become its own row.
const ownerEdges = computed(() =>
  sources.value.filter((e) => e.type === "owns" || e.type === "seat"),
);
/** One row per owner. A gmina that owns the company it seats has both edges,
 * and the row is its `owns` one - the seat is still what „Lokalizacja" is read
 * from. See `onePerNode`. */
const owners = computed(() => onePerNode(ownerEdges.value, ["owns", "seat"]));
const subsidiaries = computed(() =>
  targets.value.filter((e) => e.type === "owns" && e.richNode.type === "place"),
);

/** What "Historia powiązań" is about: the relations the owners' and the
 * subsidiaries' lists under it have not already drawn. Every ownership edge
 * used to appear on this page twice - once under „Właściciele" or „Spółki
 * zależne", and again as a history row - so a company with a parent and ten
 * subsidiaries printed all eleven, then printed the same eleven again.
 *
 * Excluding exactly what was rendered, rather than filtering the history by
 * type: `subsidiaries` only takes an outgoing `owns` whose far end is a place,
 * so dropping `owns` wholesale would take an outgoing `owns` to something that
 * is not a place off the page altogether. Identity works as the key because
 * both lists and `edges` read the same cached `sources`/`targets` computeds
 * from `useEdges`, so they hold the same objects. Every owner edge counts as
 * drawn, the ones `owners` folded into another row included: the seat of a
 * gmina already listed as an owner would otherwise turn up again in the
 * history. */
const listedAsOwnership = computed(
  () => new Set([...ownerEdges.value, ...subsidiaries.value]),
);
const historyAll = computed(() =>
  edges.value.filter((e) => !listedAsOwnership.value.has(e)),
);

/** The rows the history draws: all of it less the posts „Obecny skład” shows
 * as cards above it, so a reader meets today's board once rather than as five
 * cards and then the same five rows (Szymon, 2026-10-23). By edge id, the one
 * thing the cards (from `/api/edges/successions`) and the rows (from the local
 * graph) share - and only while the cards are drawn: before the answer is in,
 * or once the request has failed, the history keeps every row
 * (`boardEdgeIds`). A post held today that the cards do not show stays here,
 * under „Obecnie”. */
const historyEdges = computed(() => {
  const onBoard = boardEdgeIds(successions.value, successionsStatus.value);
  return historyAll.value.filter((e) => !e.id || !onBoard.has(e.id));
});

/** Where the institution sits: the region at the other end of its `seat`.
 *
 * `useCompanyLocations` answers the same question for the table, and does it by
 * fetching every region there is - worth it for a page listing hundreds of
 * companies, and absurd for one. The local graph is already loaded and the seat
 * is one of its edges.
 *
 * The seat and nothing else. This used to take the first region among the
 * owners, which was the seat for as long as the seat was the only region edge a
 * company had. Since the register's shareholder lists were ingested it is as
 * often a shareholder: PKP SKM, registered in Gdynia, read „Lokalizacja: Gmina
 * Gdańsk", and 1,437 companies in the 2026-09-27 export have a region owner
 * that is not their seat. The table, which reads `seatNodeIds`, already said
 * Gdynia. Twelve companies have a gmina owner and no seat edge at all; they
 * print no location, as they do in the table, rather than their owner's.
 */
const location = computed(
  () => sources.value.find((e) => e.type === "seat")?.richNode.name,
);

const seoCompany = computed(() =>
  status.value === "success" ? company.value : undefined,
);
const seoTitle = computed(
  () => seoCompany.value?.name ?? "Strona nieznaleziona",
);
const seoDescription = computed(() =>
  seoCompany.value
    ? entityDescription(seoCompany.value, edges.value.length, edges.value)
    : null,
);

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: () => (seoCompany.value ? entityOgType(seoCompany.value) : "website"),
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});

const canAddRelations = computed(() => !!user.value);

const addRelationOpen = ref(false);
const addRelationTypes = ref<edgeTypeExt[] | undefined>(undefined);
const addRelationTitle = ref("Dodaj powiązanie");

function openAdd(types: edgeTypeExt[] | undefined, title: string) {
  if (!user.value) {
    handleLoginRedirect();
    return;
  }
  addRelationTypes.value = types;
  addRelationTitle.value = title;
  addRelationOpen.value = true;
}

const sourcesOpen = ref(false);
const sourcesEdge = ref<EdgeNode | undefined>(undefined);

const sourcesLabel = computed(() =>
  edgeSentence(company.value?.name, sourcesEdge.value),
);

function openSources(edge: EdgeNode) {
  sourcesEdge.value = edge;
  sourcesOpen.value = true;
}

/** Both answers the page's people are drawn from, read again after one of
 * its relations was added, corrected or removed: the local graph (the
 * history, the owners, the graph) and the successions (the board's cards, the
 * relay). Today's board is listed only in its cards now, so a post removed
 * with its card's bin has to leave the card, not only the history. */
function refreshRelations() {
  return Promise.all([refreshEdges(), refreshSuccessions()]);
}

/** Refetching rather than splicing the row out in the browser: the board's
 * cards, the rows and the graph are drawn from two responses between them,
 * and the same relation is in more than one of them. */
const {
  canRemove: canRemoveRelations,
  removeOpen,
  removeEdge,
  removedShown,
  removeLabel,
  openRemove,
  onEdgeRemoved,
} = useEdgeRemoval({
  subjectName: () => company.value?.name,
  refresh: refreshRelations,
});

/** Correcting one, on the same terms as on a person's page - a job title read
 * off the register is as wrong here as it is there, and this is the page whose
 * reader knows the board. */
const {
  canEdit: canEditRelations,
  canApply: canApplyEdits,
  editOpen,
  editEdge,
  editedOutcome,
  editLabel,
  openEdit,
  onEdgeEdited,
} = useEdgeEditing({
  subjectName: () => company.value?.name,
  refresh: refreshRelations,
});
</script>

<style scoped>
/* What the page could not show belongs to the people listed above it: 12px
   under the history, as a person's withheld line sits under theirs, rather
   than a section's gap. Only there - a company with no history to draw
   (owners and nothing else) has the line as the first thing under its
   header, where it starts the page's content like any block. Out-ranks
   `k-sections` by a class, with no `!important`. */
.company-history + .company-absent {
  margin-top: 12px;
}
</style>

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
          <p class="text-caption">
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
          variant="outlined"
          to="/"
          :prepend-icon="mdiHome"
          class="ml-2"
          text="Strona główna"
        />
      </v-card-text>
    </v-card>

    <v-card v-else width="100%" style="overflow: visible">
      <div class="pa-4">
        <v-alert v-if="revisionId" type="info" variant="tonal" class="mb-4">
          Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
          <br />
          <nuxt-link :to="`/admin/rewizje/${nodeId}?revisionId=${revisionId}`">
            Zobacz historię zmian </nuxt-link
          >.
        </v-alert>

        <CardCompanySummary
          :key="nodeId"
          :company="company"
          :location="location"
          @submitted="proposals?.refresh()"
        />

        <!-- Renders nothing until the reader has proposed something for this
             company, so a page nobody has touched looks exactly as it did. -->
        <RevisionNodeProposals ref="proposals" :node-id="nodeId" />

        <div class="d-flex flex-wrap ga-2 mt-4">
          <v-btn
            variant="outlined"
            :prepend-icon="mdiGraphOutline"
            :to="`/graf?miejsce=${nodeId}`"
            text="Graf połączeń"
          />
          <v-btn
            variant="outlined"
            :prepend-icon="mdiFormatListBulleted"
            :to="`/eksploruj/tabela?place=${nodeId}`"
            text="Eksploruj powiązania"
          />
        </div>

        <SuccessionCompanyChanges
          :key="nodeId"
          :company-id="nodeId"
          :company-name="company.name"
          class="mt-6"
        />

        <div class="mt-6">
          <CardConnectionList
            :edges="owners"
            title="Właściciele"
            :can-add="canAddRelations"
            :can-remove="canRemoveRelations"
            add-testid="owners"
            @add="openAdd(['owns_parent'], 'Dodaj właściciela')"
            @remove="openRemove"
          />
          <CardConnectionList
            :edges="subsidiaries"
            title="Spółki zależne"
            :can-add="canAddRelations"
            :can-remove="canRemoveRelations"
            add-testid="subsidiaries"
            @add="openAdd(['owns_child'], 'Dodaj spółkę zależną')"
            @remove="openRemove"
          />
          <CardEmploymentHistory
            :edges="edges"
            :company="company"
            :can-add="canAddRelations"
            :can-cite="canAddRelations"
            :can-correct="canEditRelations"
            :can-remove="canRemoveRelations"
            @add="openAdd(['employed'], 'Dodaj osobę pracującą tutaj')"
            @sources="openSources"
            @edit="openEdit"
            @remove="openRemove"
          />
        </div>

        <!-- One hop by default, unlike a person's page: a company's own
             relations are already a board's worth of names, and the second ring
             is every other seat each of them holds. It is a click away in the
             bar above the canvas for a reader who wants it. -->
        <LazyGraphContainer
          v-if="!smAndDown || showGraph"
          :key="nodeId"
          class="mt-6"
          :focus-node-id="nodeId"
          :max-depth="1"
        />
        <div v-else class="mt-6 d-flex justify-center">
          <v-btn
            color="primary"
            variant="flat"
            :prepend-icon="mdiGraphOutline"
            text="Pokaż graf powiązań"
            @click="showGraph = true"
          />
        </div>

        <!-- The press on this company: the same section a person's page
             carries, off the same endpoint. `mentions` is declared for both. -->
        <MentionArticleList :node-id="nodeId" class="mt-6" />

        <NoteEditor :node-id="nodeId" node-type="place" class="mt-6" />

        <FormAddRelationDialog
          v-model="addRelationOpen"
          :node-id="nodeId"
          node-type="place"
          :node-name="company.name"
          :types="addRelationTypes"
          :title="addRelationTitle"
          @added="refreshEdges()"
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

      <v-divider />

      <div v-if="user" class="pa-4">
        <CommentsSection :node-id="nodeId" />
      </div>
    </v-card>
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
import { useEdges, type EdgeNode } from "~/composables/edges";
import { edgeSentence } from "~/utils/edgeSentence";
import { useEdgeRemoval } from "~/composables/edgeRemoval";
import { useEdgeEditing } from "~/composables/edgeEditing";
import {
  entityDescription,
  entityOgType,
  SOCIAL_CARD,
} from "~/composables/entitySeo";
import { useAuthState, authFetch } from "@/composables/auth";
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

const { data: revisionResponse } = await useAsyncData<Revision | null>(
  `revision-${route.query.revisionId || "none"}`,
  async () => {
    if (!revisionId.value) return null;
    return $fetch<Revision>(`/api/revisions/${revisionId.value}` as never);
  },
  { watch: [revisionId] },
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

const { sources, targets, refresh: refreshEdges } = await useEdges(nodeId);
const edges = computed(() => [...sources.value, ...targets.value]);
// Shareholders, and the seat while the migration is still running - once no
// region->place `owns` edge is left, `seat` here can become its own row.
const owners = computed(() =>
  sources.value.filter((e) => e.type === "owns" || e.type === "seat"),
);
const subsidiaries = computed(() =>
  targets.value.filter((e) => e.type === "owns" && e.richNode.type === "place"),
);

/** Where the institution sits, read off the region that owns it.
 *
 * `useCompanyLocations` answers the same question for the table, and does it by
 * fetching every region there is - worth it for a page listing hundreds of
 * companies, and absurd for one. The local graph is already loaded and the seat
 * is one of its `owns` edges.
 */
const location = computed(
  () => owners.value.find((e) => e.richNode.type === "region")?.richNode.name,
);

const seoCompany = computed(() =>
  status.value === "success" ? company.value : undefined,
);
const seoTitle = computed(
  () => seoCompany.value?.name ?? "Strona nieznaleziona",
);
const seoDescription = computed(() =>
  seoCompany.value
    ? entityDescription(seoCompany.value, edges.value.length)
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

/** Refetching rather than splicing the row out in the browser: the board
 * summary at the top of the page, the rows and the graph all read the one
 * local-graph response. */
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
  refresh: refreshEdges,
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
  refresh: refreshEdges,
});
</script>

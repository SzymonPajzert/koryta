<template>
  <div style="width: 100%">
    <v-card
      v-if="status != 'success'"
      class="mb-4"
      :title="!user ? 'Dostęp zastrzeżony' : status"
    >
      <v-card-text v-if="!user" class="pt-0">
        <p class="mb-4">
          Ta strona nie została znaleziona lub oczekuje na zatwierdzenie.
          Niezaakceptowane strony są widoczne tylko dla zalogowanych
          użytkowników.
        </p>
        <v-btn color="primary" @click="handleLoginRedirect()">
          Zaloguj się
        </v-btn>
      </v-card-text>
      <v-card-text v-else class="pt-0">
        <v-alert type="warning" variant="tonal" class="mb-4">
          <p class="mb-2">Strona nie mogła zostać załadowana.</p>
          <p class="text-caption">
            Prawdopodobnie strona nie istnieje, została usunięta lub nie masz do
            niej dostępu. Upewnij się, że adres URL jest prawidłowy.
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
        <v-btn variant="outlined" to="/" :prepend-icon="mdiHome" class="ml-2">
          Strona główna
        </v-btn>
      </v-card-text>
    </v-card>
    <template v-else-if="node == 'teryt1261'">
      <v-row>
        <v-col cols="12" sm="9">
          <v-card>
            <v-card-title class="d-flex justify-center mt-3 text-wrap">
              <h2 class="text-h4 font-weight-bold mr-2">
                Statystyki koryciarstwa Krakowa
              </h2>
            </v-card-title>
            <v-card-text class="justify-center text-center">
              Podsumowanie, ile osób aktualnie u władzy jest lub kiedykolwiek
              było zatrudnionych w spółkach publicznych lub instytucjach.
            </v-card-text>
          </v-card>
        </v-col>
        <v-col
          cols="12"
          sm="3"
          height="100%"
          class="d-flex align-center justify-center"
        >
          <v-hover v-slot="{ isHovering, props: hoverProps }">
            <v-btn
              v-bind="hoverProps"
              border="md opacity-100 primary"
              class="text-none pl-6"
              color="primary"
              height="60"
              rounded="pill"
              spaced="end"
              text="Zobacz wszystkie osoby"
              variant="outlined"
              width="250"
              to="/eksploruj/tabela?teryt=1261"
            >
              <template #append>
                <v-avatar variant="text">
                  <v-progress-circular
                    bg-color="transparent"
                    color="primary"
                    :model-value="isHovering ? 100 : 0"
                    width="2"
                  >
                    <v-icon :icon="mdiArrowRight" />
                  </v-progress-circular>
                </v-avatar>
              </template>
            </v-btn>
          </v-hover>
        </v-col>
      </v-row>

      <RegionPeopleStatistics teryt="1261" class="mt-2" />
      <RegionPeopleStatistics teryt="12" />
    </template>
    <v-card v-else width="100%" style="overflow: visible">
      <div class="pa-4">
        <v-alert v-if="revisionId" type="info" variant="tonal" class="mb-4">
          Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
          <br />
          <nuxt-link :to="`/admin/rewizje/${node}?revisionId=${revisionId}`"
            >Zobacz historię zmian</nuxt-link
          >.
        </v-alert>

        <div v-if="entity?.type === 'region'" class="mb-4 d-flex">
          <v-btn
            variant="tonal"
            :prepend-icon="mdiFormatListBulleted"
            :to="`/eksploruj/tabela?teryt=${regionTeryt}`"
          >
            Eksploruj region
          </v-btn>
        </div>
        <EntityDetailsCard
          v-if="entity"
          :key="sourcePath"
          :entity="entity"
          :type="type"
          :extra-locations="electionLocations"
        />

        <div class="mt-4">
          <!-- A place is served by `place/DetailView.vue` and never reaches
               here. The branch that used to draw one lived on for three months
               after `generateNodeUrl` stopped routing anything to it, and its
               relations rendered twice - once as rows, once again through the
               `v-else` below, which binds to the person branch rather than to
               the chain of them. -->
          <template v-if="entity?.type === 'region'">
            <CardConnectionList
              :edges="owners"
              title="Część regionu"
              :can-remove="canRemoveRelations"
              @remove="openRemove"
            />
            <CardConnectionList
              :edges="subregions"
              title="Regiony"
              :can-remove="canRemoveRelations"
              @remove="openRemove"
            />
            <CardConnectionList
              :edges="subsidiaries"
              title="Spółki zależne"
              :can-remove="canRemoveRelations"
              @remove="openRemove"
            />
          </template>
          <template v-if="entity?.type === 'person'">
            <CardEmploymentHistory
              :edges="edges"
              :can-add="canAddRelations"
              :can-cite="canAddRelations"
              :can-correct="canEditRelations"
              :can-remove="canRemoveRelations"
              :predecessors="predecessors"
              @add="openAdd(undefined, 'Dodaj powiązanie')"
              @sources="openSources"
              @edit="openEdit"
              @remove="openRemove"
            />
            <!-- The rows above only hint at a handover; this states it, and
                 says how much of the history it covers. It renders nothing at
                 all when there is nothing to say. -->
            <SuccessionPersonChanges
              :person-id="node"
              :person-name="entity.name"
              :person-parties="(entity as Person).parties"
              :relation-count="edges.length"
              class="mt-4"
            />
          </template>
          <v-row v-else>
            <v-col
              v-for="edge in edges.filter((edge) => {
                const t = entity?.type || type;
                if (t === 'place' || t === 'region') {
                  return ['employed', 'connection'].includes(edge.type);
                }
                return ['employed', 'connection', 'owns', 'election'].includes(
                  edge.type,
                );
              })"
              :key="edge.richNode?.name"
              cols="12"
              md="6"
            >
              <CardShortNode
                :edge="edge"
                :can-remove="canRemoveRelations"
                @remove="openRemove"
              />
            </v-col>
          </v-row>
        </div>

        <!-- `comment` only. `mentions` used to be filtered for here too and
             could never match: `edges` comes from /api/graph/local/[id], which
             builds its node map from people, places and regions, then drops
             every edge whose far end is not in it - and the far end of a
             mention is an article. The articles that name this entity have
             their own section below, off an endpoint that can see them. -->
        <div class="mt-4">
          <v-row>
            <v-col
              v-for="edge in edges.filter((edge) => edge.type === 'comment')"
              :key="edge.richNode?.name"
              cols="12"
              md="6"
            >
              <CardShortNode
                :edge="edge"
                :can-remove="canRemoveRelations"
                @remove="openRemove"
              />
            </v-col>
          </v-row>
        </div>

        <!-- Where a claim on this page came from, and what else has been
             written about them. Only for the kinds `mentions` is declared
             between; a region is never one end of one. -->
        <MentionArticleList
          v-if="entity?.type === 'person' || entity?.type === 'place'"
          :node-id="node"
        />

        <!-- Notes on a person are unreviewed claims about a named individual,
             so a reader has to be logged in to see them. Everything else -
             companies, regions, topics - stays open. -->
        <NoteEditor
          v-if="user || entity?.type !== 'person'"
          :node-id="node"
          :node-type="type"
          class="mt-4"
        />

        <!-- Last on the page, under the relations it draws. The rows above are
             the record - who, where, when, cited; the graph is the same facts
             arranged so a shape can be seen in them, and it is only worth
             looking at once the reader knows what they are looking for. -->
        <!-- Two hops for a person, not one. One hop is their own relations,
             which the rows above already give in full, with dates and sources -
             the canvas was redrawing the list as a star and adding nothing. The
             second ring is the part a list cannot show: who else sits on those
             boards, and where those people sit besides.

             A region stays at one. It owns every institution inside it, so its
             first ring is already a hundred companies and its second would be
             every person on all of their boards - the explosion
             `expandableFrontier` refuses to walk into, entered from the other
             end. Either way the reader can change it in the bar above the
             canvas. -->
        <LazyGraphContainer
          v-if="!smAndDown || showGraph"
          :key="node"
          class="mt-4"
          :focus-node-id="node"
          :max-depth="entity?.type === 'person' ? 2 : 1"
        />
        <div v-else class="mt-4 d-flex justify-center">
          <!-- Flat, not tonal: tonal draws the label in the theme's pale sage
               on a wash of the same sage, which is 1.73:1. Flat is black on
               sage. -->
          <v-btn
            color="primary"
            variant="flat"
            :prepend-icon="mdiGraphOutline"
            @click="showGraph = true"
          >
            Pokaż graf powiązań
          </v-btn>
        </div>

        <!-- Under the graph. The facts themselves are for logged in readers
             only - they are a model's reading of a newspaper, matched by name
             and judged by nobody yet, and this is the indexed public url for a
             named individual - so the section locks itself and shows a logged
             out reader only how many there are. That gate lives inside the
             component, because the count is public and the facts are not. -->
        <ExtractionPersonFacts
          v-if="entity?.type === 'person'"
          :node-id="node"
        />

        <FormAddRelationDialog
          v-if="entity"
          v-model="addRelationOpen"
          :node-id="node"
          :node-type="entity.type"
          :node-name="entity.name"
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

        <div v-if="referencedIn.length" class="mt-4">
          <h3 class="text-h6 mb-2">Artykuł stanowi źródło dla:</h3>
          <v-row>
            <v-col v-for="edge in referencedIn" :key="edge.id" cols="12" md="6">
              <CardShortNode :edge="edge" />
            </v-col>
          </v-row>
        </div>

        <!-- template v-if="user && entity">
          <template v-if="userWantsEdit">
            <div class="mt-4">
              <v-btn
                v-if="entity?.type !== 'region'"
                variant="tonal"
                :prepend-icon="mdiPencilOutline"
                @click="handleEdit"
              >
                <template #prepend>
                  <v-icon color="warning" />
                </template>
                Zaproponuj zmianę
              </v-btn>
              <DialogProposeRemoval
                v-if="entity && entity.type !== 'region'"
                :id="node"
                :type="type"
                :name="entity.name"
              >
                <template #activator="{ props }">
                  <v-btn
                    v-bind="user ? props : {}"
                    variant="tonal"
                    class="ml-2"
                    @click="!user && handleLoginRedirect()"
                  >
                    <template #prepend>
                      <v-icon color="error" :icon="mdiDeleteOutline" />
                    </template>
                    Zaproponuj usunięcie
                  </v-btn>
                </template>
              </DialogProposeRemoval>
            </div>

            <div class="mt-4">
              <h4 class="text-subtitle-2 mb-2">Szybkie dodawanie</h4>
              <div class="d-flex flex-column gap-2">
                <v-btn
                  v-for="btn in quickAddButtons"
                  :key="btn.text"
                  variant="tonal"
                  size="small"
                  :prepend-icon="btn.icon"
                  class="mr-2 mb-2"
                  :data-testid="'edge-picker-' + btn.edgeType"
                  @click="quickAddEdge(btn)"
                >
                  {{ btn.text }}
                </v-btn>
              </div>
            </div>
          </template>
          <div v-else class="d-flex mt-4">
            <v-spacer />
            <v-btn color="primary" @click="userWantsEdit = true">
              Edytuj stronę
            </v-btn>
            <v-spacer />
          </div>
        </template-->
      </div>

      <!--div v-if="editedEdge" class="pa-4">
        <FormEditEdge
          :key="node"
          :node-id="node"
          :node-type="type"
          :node-name="entity?.name || ''"
          :edge-type-ext="editedEdge.edgeTypeExt"
          :initial-direction="editedEdge.direction"
          :edited-edge="undefined"
          @update="onEdgeUpdate"
        />
      </div -->

      <v-divider />

      <template v-if="!!user">
        <div class="pa-4">
          <CommentsSection :node-id="node" />
        </div>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import {
  mdiArrowRight,
  mdiFormatListBulleted,
  mdiGraphOutline,
  mdiHome,
  mdiRefresh,
} from "@mdi/js";
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
import type {
  Person,
  Company,
  Article,
  Region,
  NodeType,
  Revision,
} from "~~/shared/model";
import { predecessorsByEdge } from "~/utils/succession";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import FormAddRelationDialog from "~/components/form/AddRelationDialog.vue";
import type { edgeTypeExt } from "~/composables/useEdgeTypes";
import { useDisplay } from "vuetify";

definePageMeta({
  affineLink: "0Jk7aUVzpBbKpnGw-NNqZ",
});

const props = defineProps<{
  node: string;
  type: NodeType;
}>();

const node = props.node;
const type = props.type;

const route = useRoute();

const { user } = useAuthState();
const router = useRouter();

const { smAndDown } = useDisplay();
const showGraph = ref(false);

const handleLoginRedirect = () => {
  router.push({
    path: "/login",
    query: { redirect: route.fullPath },
  });
};

const sourcePath = computed(() => `/api/nodes/${node}`);
const {
  data: response,
  status,
  refresh: refreshNode,
} = await authFetch<{
  node: Person | Company | Article | Region;
}>(sourcePath);

watch(
  user,
  (newUser) => {
    if (newUser && status.value === "error") {
      refreshNode();
    }
  },
  { immediate: true },
);

const revisionId = computed(() => route.query.revisionId as string | undefined);

const { data: revisionResponse } = await useAsyncData<Revision | null>(
  `revision-${route.query.revisionId || "none"}`,
  async () => {
    if (!revisionId.value) return null;
    return $fetch<Revision>(`/api/revisions/${revisionId.value}` as never);
  },
  { watch: [revisionId] },
);

const entity = computed(() => {
  if (revisionId.value && revisionResponse.value?.data) {
    return {
      ...response.value?.node,
      ...revisionResponse.value.data,
    } as unknown as Person | Company | Article | Region;
  }
  return response.value?.node;
});

const regionTeryt = computed(() => {
  if (entity.value && entity.value.type === "region") {
    return entity.value.teryt;
  }
  return undefined;
});

// Calculate edges and relationships
const {
  sources,
  targets,
  referencedIn,
  refresh: refreshEdges,
} = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);

/** Who held each of this person's seats before them, keyed by the relation it
 * is a hint on.
 *
 * `SuccessionPersonChanges` below reads the same response under the same key,
 * so asking here costs nothing beyond the join - and the join has to happen
 * here because only this component holds the edges the rows are drawn from.
 * Empty for a node that is not a person: the endpoint answers about employment
 * spells, and a region has none.
 */
// Asked for at all only on a profile. `type` comes from the url prefix and
// never changes for the life of the component - the page re-creates it by
// `:key` when the node does - so the branch is safe to take at setup time, and
// it keeps a region or a topic from asking about employment spells it has none
// of.
const successions = type === "person" ? usePersonSuccessions(node) : undefined;
const predecessors = computed(() =>
  predecessorsByEdge(successions?.data.value?.posts ?? [], edges.value),
);
/** The towns this person stood for election in, off the edges the page already
 * holds.
 *
 * The node itself carries no `elections`: those are reconstructed from a
 * subgraph, which only the table fetches. Without them the explore button in
 * the header would search the bare name and nothing else - and the town
 * somebody asked to represent is what separates a councillor from every
 * namesake in the country. Empty for anything that is not a person, which has
 * no election edges.
 */
const electionLocations = computed(() =>
  edges.value
    .filter((edge) => edge.type === "election" && edge.richNode?.name)
    .map((edge) => edge.richNode.name),
);

const owners = computed(() => {
  return sources.value.filter((e) => e.type === "owns");
});
const subregions = computed(() => {
  return targets.value.filter(
    (e) => e.type === "owns" && e.richNode.type === "region",
  );
});
const subsidiaries = computed(() => {
  return targets.value.filter(
    (e) =>
      (e.type === "owns" || e.type === "seat") && e.richNode.type == "place",
  );
});

/** An entity page is the thing a reader actually shares, so it carries its own
 * card: the entity's own description rather than the site tagline, and an image,
 * without which every platform renders the link as bare text.
 *
 * Everything is guarded on a successful load. A page that is missing, or a draft
 * an anonymous visitor may not see, renders "Dostęp zastrzeżony" - describing
 * that as though it were the entity would put the wrong name on the card.
 */
const seoEntity = computed(() =>
  status.value === "success" ? entity.value : undefined,
);
const seoTitle = computed(
  () => seoEntity.value?.name ?? "Strona nieznaleziona",
);
const seoDescription = computed(() =>
  seoEntity.value
    ? entityDescription(seoEntity.value, edges.value.length)
    : null,
);

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: () => (seoEntity.value ? entityOgType(seoEntity.value) : "website"),
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});

/** The relations a reader may add by hand: who somebody knows, and where they
 * work. Ownership and candidacies come from the registers rather than from a
 * form, and an article's mentions are added while reading the article. */
/** Adding is for signed in readers; a logged out one is sent to /login by the
 * button rather than shown a form they cannot submit. */
const canAddRelations = computed(() => !!user.value);

const addRelationOpen = ref(false);
const addRelationTypes = ref<edgeTypeExt[] | undefined>(undefined);
const addRelationTitle = ref("Dodaj powiązanie");

/** Opens the composer scoped to whichever section asked for it, so the verb
 * chips inside are usually down to one or two. */
function openAdd(types: edgeTypeExt[] | undefined, title: string) {
  if (!user.value) {
    handleLoginRedirect();
    return;
  }
  addRelationTypes.value = types;
  addRelationTitle.value = title;
  addRelationOpen.value = true;
}

/** The relation whose sources are on screen. One dialog for the whole page
 * rather than one per row: a person with fifty relations would otherwise mount
 * fifty of them, each with its own picker. */
const sourcesOpen = ref(false);
const sourcesEdge = ref<EdgeNode | undefined>(undefined);

const sourcesLabel = computed(() =>
  edgeSentence(entity.value?.name, sourcesEdge.value),
);

function openSources(edge: EdgeNode) {
  sourcesEdge.value = edge;
  sourcesOpen.value = true;
}

/** Refetching rather than splicing the row out in the browser: the same
 * relation can be drawn by the rows, the grid below them and the graph, and all
 * three read the one local-graph response. */
const {
  canRemove: canRemoveRelations,
  removeOpen,
  removeEdge,
  removedShown,
  removeLabel,
  openRemove,
  onEdgeRemoved,
} = useEdgeRemoval({
  subjectName: () => entity.value?.name,
  refresh: refreshEdges,
});

/** Correcting what a relation says, from the row that says it. Open to anyone
 * signed in rather than to admins alone - `/api/edges/update` files a
 * contributor's version as a proposal - which is why it does not share
 * `canRemoveRelations` above. */
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
  subjectName: () => entity.value?.name,
  refresh: refreshEdges,
});
</script>

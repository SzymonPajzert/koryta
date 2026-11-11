<template>
  <div style="width: 100%">
    <!-- A person nobody has published, to a reader who is not signed in: their
         name and latest post, and the way to sign in for the rest - rather
         than a wall that did not even say whose page it was. -->
    <CardPersonTeaser
      v-if="status != 'success' && teaserWanted && teaser"
      :teaser="teaser"
      :node-id="node"
    />
    <!-- Titled as a company's page titles it. A signed in reader whose load
         failed used to read the fetch's own status here: „error”. -->
    <v-card
      v-else-if="status != 'success'"
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
          <!-- 14px: two sentences are prose, and prose is never 12px. -->
          <p class="text-body-2">
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
        <v-btn variant="tonal" to="/" :prepend-icon="mdiHome" class="ml-2">
          Strona główna
        </v-btn>
      </v-card-text>
    </v-card>
    <!-- Kraków's statistics, the one region page drawn by hand. It opens as
         every page does: the h1 at the page-top inset, one sentence under it
         and the page's own button beside them, in the head the admin and
         working pages share. It used to be a centred 24px h2 in a ruled card,
         the only page with no h1, and on a phone a title smaller than the
         section heads under it. -->
    <template v-else-if="node == 'teryt1261'">
      <AdminPageHead
        title="Statystyki koryciarstwa Krakowa"
        lead="Podsumowanie, ile osób aktualnie u władzy jest lub kiedykolwiek było zatrudnionych w spółkach publicznych lub instytucjach."
      >
        <template #actions>
          <!-- A sage fill with dark text rather than sage text in a sage
               outline: sage is a fill and never text, 1.85:1 on white, and
               this is how the entity pages' own buttons wear it (Szymon,
               2026-10-23: „controls only, now”). -->
          <v-btn
            color="primary"
            variant="flat"
            :append-icon="mdiArrowRight"
            to="/eksploruj/tabela?teryt=1261"
            text="Zobacz wszystkie osoby"
          />
        </template>
      </AdminPageHead>

      <!-- The city council and the regional assembly: two sections, one
           section gap apart. A reader who came from somebody's run in Kraków
           meets that person above them, as on any region's page, and the
           city's lists under them. -->
      <div class="k-sections">
        <RegionPersonRuns
          v-if="personHere && personRuns.length"
          :person="personHere"
          :runs="personRuns"
          :kind="kindOfRegion"
          :wariant="wariant"
        />
        <RegionPeopleStatistics teryt="1261" />
        <RegionPeopleStatistics teryt="12" />
        <RegionElectionLists
          :region-id="node"
          :groups="electionGroups"
          :highlight-id="osoba"
          :open-keys="openListKeys"
        />
      </div>
    </template>
    <!-- The page sits on the page: no card around it, so the name, the
         sections and the lists share one left edge with the bar above, and a
         phone gives them its full width. With the card gone, `k-sections`
         is what spaces them: one gap above each block, none of them carrying
         a margin of its own (assets/css/edges.css). -->
    <div v-else class="w-100 k-sections">
      <v-alert v-if="revision" type="info" variant="tonal">
        Wyświetlasz podgląd zaproponowanej zmiany na tej stronie.
        <br />
        <nuxt-link :to="`/admin/rewizje/${node}?revisionId=${revisionId}`"
          >Zobacz historię zmian</nuxt-link
        >.
      </v-alert>

      <!-- A region opens with the admin pages' head (system.md, 2026-10-24:
           „the region page use[s] the admin pages' head”): the name at the
           page top, where it sits on it in the trail of the places above, and
           „Eksploruj region” beside it. Szymon, board round region-lists-r1,
           on the card head: "A bit too much of the negative space here." -->
      <AdminPageHead
        v-if="entity?.type === 'region' && glowa !== 'karta'"
        :title="regionTitle"
      >
        <template v-if="regionAncestors.length || trailKind" #meta>
          <RegionTrail :ancestors="regionAncestors" :kind-label="trailKind" />
        </template>
        <template #actions>
          <v-btn
            variant="tonal"
            :prepend-icon="mdiFormatListBulleted"
            :to="`/eksploruj/tabela?teryt=${regionTeryt}`"
          >
            Eksploruj region
          </v-btn>
        </template>
      </AdminPageHead>
      <!-- The header, as one block: a region's „Eksploruj region” belongs to
           the name under it and stays 16px above it, where on its own it would
           stand a section's gap away. A wrapper rather than a class on the
           card, which renders one root per type and so takes none.
           TEMP(wariant) glowa=karta: a region's old card head, for the board
           round's comparison. -->
      <div v-else>
        <div v-if="entity?.type === 'region'" class="d-flex mb-4">
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
          :extra-locations="searchLocations"
          :ancestors="regionAncestors"
          @published="refreshNode()"
          @voted="emit('voted')"
        />
      </div>

      <!-- A place is served by `place/DetailView.vue` and never reaches
           here. The branch that used to draw one lived on for three months
           after `generateNodeUrl` stopped routing anything to it, and its
           relations rendered twice - once as rows, once again through the
           `v-else` below, which binds to the person branch rather than to
           the chain of them. -->
      <template v-if="entity?.type === 'region'">
        <!-- Who the reader came from, when they came from a run on
             somebody's page: that person's runs here, each with the way to
             the list it was on. First, because it is what the click was
             for. -->
        <RegionPersonRuns
          v-if="personHere && personRuns.length"
          :person="personHere"
          :runs="personRuns"
          :kind="kindOfRegion"
          :wariant="wariant"
        />
        <!-- Who governs the place: where Szymon pinned it on the board,
             above the lists (region-lists-r1). -->
        <RegionAuthorities
          v-if="authorities"
          :authorities="authorities"
          :pointer-target="pointerTarget"
          :highlight-id="osoba"
          :wariant="wladze"
          :composition="composition"
        />
        <!-- Before the institutions: the people of a region are what its
             page has to say about it, as a person's history lists the
             people first. -->
        <RegionElectionLists
          :region-id="node"
          :groups="electionGroups"
          :highlight-id="osoba"
          :open-keys="openListKeys"
        />
        <!-- The region above is the line under the name now (Szymon,
             region-lists-r1). The list stays for an admin, whose removal
             and „Opublikuj” of that relation live on its rows. -->
        <CardConnectionList
          v-if="canRemoveRelations"
          :edges="owners"
          title="Część regionu"
          :can-remove="canRemoveRelations"
          :subject-published="subjectPublished"
          @remove="openRemove"
          @published="refreshEdges()"
        />
        <CardConnectionList
          :edges="subregions"
          title="Regiony"
          :can-remove="canRemoveRelations"
          :subject-published="subjectPublished"
          @remove="openRemove"
          @published="refreshEdges()"
        />
        <CardConnectionList
          :edges="subsidiaries"
          title="Spółki zależne"
          :can-remove="canRemoveRelations"
          :subject-published="subjectPublished"
          @remove="openRemove"
          @published="refreshEdges()"
        />
      </template>
      <template v-if="entity?.type === 'person'">
        <CardEmploymentHistory
          :edges="edges"
          bleed
          ledger
          :can-add="canAddRelations"
          :can-cite="canAddRelations"
          :can-correct="canEditRelations"
          :can-remove="canRemoveRelations"
          :subject-published="subjectPublished"
          :predecessors="predecessors"
          @add="openAdd(undefined, 'Dodaj powiązanie')"
          @sources="openSources"
          @edit="openEdit"
          @remove="openRemove"
          @published="refreshEdges()"
        />
        <!-- The rows above only hint at a handover; this states it, and
             says how much of the history it covers. It renders nothing at
             all when there is nothing to say. -->
        <SuccessionPersonChanges
          :person-id="node"
          :person-name="entity.name"
          :person-parties="(entity as Person).parties"
          :relation-count="listedRelationCount"
        />
      </template>
      <!-- In a plain div, as `k-sections` asks of a `v-row`, and only when
           there is a card to show - see the comments below. -->
      <div v-else-if="shortEdges.length">
        <v-row>
          <v-col
            v-for="edge in shortEdges"
            :key="edge.richNode?.name"
            cols="12"
            md="6"
          >
            <CardShortNode
              :edge="edge"
              :can-remove="canRemoveRelations"
              :subject-published="subjectPublished"
              @remove="openRemove"
              @published="refreshEdges()"
            />
          </v-col>
        </v-row>
      </div>

      <!-- `comment` only. `mentions` used to be filtered for here too and
             could never match: `edges` comes from /api/graph/local/[id], which
             builds its node map from people, places and regions, then drops
             every edge whose far end is not in it - and the far end of a
             mention is an article. The articles that name this entity have
             their own section below, off an endpoint that can see them.
             Only when there is one: the empty row that stood here on every
             page kept its -12px margins, and cut the gap under „Zmiany na
             stanowisku” to 8px. -->
      <div v-if="commentEdges.length">
        <v-row>
          <v-col
            v-for="edge in commentEdges"
            :key="edge.richNode?.name"
            cols="12"
            md="6"
          >
            <CardShortNode
              :edge="edge"
              :can-remove="canRemoveRelations"
              :subject-published="subjectPublished"
              @remove="openRemove"
              @published="refreshEdges()"
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
        :with-declarations="entity?.type === 'person'"
      />

      <!-- Notes on a person are unreviewed claims about a named individual,
             so a reader has to be logged in to see them. Everything else -
             companies, regions, topics - stays open.
             `columns`: two notes to a row on a desktop, where one full-width
             column left half the screen empty beside each of them. A person's
             page only - that is where it was asked for; a region's is drawn by
             this component too and was not part of the request, and the
             table's side panel mounts the same editor and was asked to stay a
             single stack. -->
      <NoteEditor
        v-if="user || entity?.type !== 'person'"
        :node-id="node"
        :node-type="type"
        :columns="type === 'person'"
        @saved="emit('noted')"
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
      <!-- Headed like every other section, so the page reads as a list of
           titled blocks down to its end rather than a canvas that starts
           where the last list stops. On a phone the head stands over the
           button that opens it. Not at all for a page with no relations: its
           graph is the one node, which is a heading over nothing. -->
      <PageSection
        v-if="edges.length > 0"
        title="Graf powiązań"
        data-testid="entity-graph"
      >
        <LazyGraphContainer
          v-if="!smAndDown || showGraph"
          :key="node"
          class="k-bleed-xs"
          :focus-node-id="node"
          :max-depth="entity?.type === 'person' ? 2 : 1"
        />
        <!-- Flat, not tonal: tonal draws the label in the theme's pale sage
             on a wash of the same sage, which is 1.73:1. Flat is black on
             sage. -->
        <v-btn
          v-else
          color="primary"
          variant="flat"
          :prepend-icon="mdiGraphOutline"
          @click="showGraph = true"
        >
          Pokaż graf powiązań
        </v-btn>
      </PageSection>

      <!-- Under the graph. The facts themselves are for logged in readers
             only - they are a model's reading of a newspaper, matched by name
             and judged by nobody yet, and this is the indexed public url for a
             named individual - so the section locks itself and shows a logged
             out reader only how many there are. That gate lives inside the
             component, because the count is public and the facts are not. -->
      <!-- A fact turned into a relation is a new draft in „Historia
             powiązań” above, so that list is read again, as it is after
             „Dodaj”. -->
      <ExtractionPersonFacts
        v-if="entity?.type === 'person'"
        :node-id="node"
        @promoted="refreshEdges()"
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

      <div v-if="referencedIn.length">
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

      <CommentsSection v-if="user" :node-id="node" />
    </div>
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
import {
  employmentSpell,
  onePerNode,
  useEdges,
  type EdgeNode,
} from "~/composables/edges";
import { edgeSentence } from "~/utils/edgeSentence";
import { useEdgeRemoval } from "~/composables/edgeRemoval";
import { useEdgeEditing } from "~/composables/edgeEditing";
import {
  entityDescription,
  entityOgType,
  SOCIAL_CARD,
} from "~/composables/entitySeo";
import { useAuthState, authFetch, authRequest } from "@/composables/auth";
import type {
  Person,
  Company,
  Article,
  Region,
  NodeType,
  Revision,
} from "~~/shared/model";
import { withoutRedundantRoleless } from "~~/shared/rolelessSpells";
import { predecessorsByEdge } from "~/utils/succession";
import { employmentTowns } from "~/utils/companyLocation";
import CommentsSection from "@/components/comment/CommentsSection.vue";
import FormAddRelationDialog from "~/components/form/AddRelationDialog.vue";
import type { edgeTypeExt } from "~/composables/useEdgeTypes";
import type { PersonTeaser } from "~~/shared/personTeaser";
import {
  groupElectionLists,
  personRunsIn,
  regionKind,
  type ListMember,
} from "~~/shared/electionLists";
import {
  useRegionComposition,
  useRegionElectionRuns,
} from "~/composables/electionLists";
import { regionAuthorities } from "~~/shared/regionAuthorities";
import { nodeLinkUrl } from "~~/shared/slugs";
import { wojewodztwoLabel } from "~~/shared/teryt";
import { useRegionAncestors } from "~/composables/regionAncestors";
import { useDisplay } from "vuetify";

definePageMeta({
  affineLink: "0Jk7aUVzpBbKpnGw-NNqZ",
});

const props = defineProps<{
  node: string;
  type: NodeType;
}>();

/** For the review queue on /eksploruj/nowe, which draws this page under its
 * one-row table and ticks its „Notatka” and „Głos” steps off on these. */
const emit = defineEmits<{
  /** A note was saved on the page. */
  noted: [];
  /** The reader voted from the page's own header. */
  voted: [];
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

/** What a logged out reader is shown of a person whose page is not theirs to
 * read - published by nobody yet. The server renders every page anonymously,
 * so the teaser is in the html it sends; a signed in reader's own copy of the
 * page then loads over it, and the teaser is dropped. A 404 here - a page that
 * does not exist, or one that was removed - leaves the wall as it was. */
const teaserWanted = computed(
  () => type === "person" && status.value === "error" && !user.value,
);
const { data: teaser } = await useAsyncData<PersonTeaser | null>(
  `person-teaser-${node}`,
  () =>
    teaserWanted.value
      ? $fetch<PersonTeaser>(`/api/nodes/${node}/teaser`).catch(() => null)
      : Promise.resolve(null),
  { watch: [teaserWanted] },
);
// Never indexed: the status line already says 404 (`[seoType]/[slug].vue`),
// and this says it again for anything that reads only the page - a name nobody
// has checked is not something to put in a search engine. Decided once, at
// setup: it only matters to the server's render, which is what a crawler gets.
if (teaser.value && status.value !== "success") {
  useRobotsRule("noindex, nofollow");
}

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

/** The proposed change, once it is known to be about this page. The id is the
 * url's, and on /eksploruj/nowe the url outlives the person: the queue moves on
 * without leaving the page, so a change proposed for one person would otherwise
 * be laid over whoever came next. */
const revision = computed(() => {
  const loaded = revisionResponse.value;
  if (!revisionId.value || !loaded?.data) return undefined;
  // Both spellings are in the data; see `revisionTargetRef`.
  const target = loaded.node_id ?? loaded.nodeId;
  return target && target !== node ? undefined : loaded;
});

const entity = computed(() => {
  if (revision.value) {
    return {
      ...response.value?.node,
      ...revision.value.data,
    } as unknown as Person | Company | Article | Region;
  }
  return response.value?.node;
});

/** Whether the page itself is live, which is what decides whether one of its
 * relations may be. A draft's relations cannot be published at all - and do not
 * need to be from here, since the „Opublikuj" dialog on the draft badge
 * publishes them along with the page. */
const subjectPublished = computed(() => entity.value?.published === true);

const regionTeryt = computed(() => {
  if (entity.value && entity.value.type === "region") {
    return entity.value.teryt;
  }
  return undefined;
});

/** Who stood for election in this region, for its lists and for the box at
 * the top. Asked at all only on a region's page; `type` never changes for the
 * life of the component (see `successions` below). Started before the graph
 * request and awaited after it, so the two run side by side and the page
 * opens with the box in it: arriving from a run on somebody's page is a
 * navigation inside the site, and the box is what the click was for - drawn
 * a moment late, it pushed the whole page down under the reader. */
const electionRuns =
  type === "region" ? useRegionElectionRuns(node) : undefined;

/** The regions above this one, for the line under its name. Started here
 * and awaited with the graph below, so the line is in the page as it opens
 * rather than pushing the page down a moment later. */
const regionAncestorsData =
  type === "region" && node !== "teryt1261"
    ? useRegionAncestors(regionTeryt)
    : undefined;
const regionAncestors = computed(() => regionAncestorsData?.data.value ?? []);
/** PKW's whole 2024 result, for the preview of „Władze” (TEMP(wariant)
 * wladze=c). */
const compositionData =
  type === "region"
    ? useRegionComposition(node, () => route.query.wladze === "c")
    : undefined;
const composition = computed(() => compositionData?.data.value ?? null);

// Calculate edges and relationships
const {
  sources,
  targets,
  referencedIn,
  refresh: refreshEdges,
} = await useEdges(node);
await Promise.all([electionRuns, regionAncestorsData, compositionData]);
const edges = computed(() => [...sources.value, ...targets.value]);

/** The relations a page that is not a person's lists as cards. */
const shortEdges = computed(() => {
  const t = entity.value?.type || type;
  const kinds =
    t === "place" || t === "region"
      ? ["employed", "connection"]
      : ["employed", "connection", "owns", "election"];
  return edges.value.filter((edge) => kinds.includes(edge.type));
});
const commentEdges = computed(() =>
  edges.value.filter((edge) => edge.type === "comment"),
);

/** How many rows the relation history lists, for the coverage line of
 * „Zmiany na stanowisku" - which says "2 z 8" and should not count a row the
 * card above it leaves out. The card drops the role-less copy of a post this
 * person also holds under its name; see `withoutRedundantRoleless`. */
const listedRelationCount = computed(
  () => withoutRedundantRoleless(edges.value, employmentSpell).length,
);

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

/** Where to search the person in: the election towns, then the towns their
 * employers sit in - the order `usePersonSearch` documents. Without the second
 * half the menu searched Rafał Dyjur in „Powiat lwówecki", where he stood, and
 * not in Jelenia Góra, where the hospital he works for is and which his own
 * page printed beside its name. The table's drawer gets them from
 * `useCompanyLocations`, which fetches every region there is - well over a
 * megabyte that each reader of this page would pay for a menu only an admin
 * sees - while the employers' names already carry them. */
const searchLocations = computed(() => [
  ...electionLocations.value,
  ...employmentTowns(edges.value),
]);

const owners = computed(() => {
  return sources.value.filter((e) => e.type === "owns");
});
const subregions = computed(() => {
  return targets.value.filter(
    (e) => e.type === "owns" && e.richNode.type === "region",
  );
});
const electionGroups = computed(() =>
  groupElectionLists(electionRuns?.data.value?.runs ?? []),
);

/** The person whose run the reader followed here: `?osoba=` on the link from
 * a run on their page (card/EmploymentHistory.vue). */
const osoba = computed(() =>
  typeof route.query.osoba === "string" ? route.query.osoba : undefined,
);
const personRuns = computed(() =>
  osoba.value
    ? personRunsIn(
        osoba.value,
        electionRuns?.data.value?.runs ?? [],
        electionGroups.value,
      )
    : [],
);
/** Who they are, as the lists name them: undefined where they stood for
 * nothing here this reader may see, and then there is no box. */
const personHere = computed<ListMember | undefined>(() => {
  const run = electionRuns?.data.value?.runs?.find(
    (each) => each.personId === osoba.value,
  );
  return run
    ? {
        personId: run.personId,
        personName: run.personName,
        parties: run.parties,
        ...(run.partyHidden ? { partyHidden: true } : {}),
        published: run.published,
        offices: [],
        elected: false,
      }
    : undefined;
});

/** TEMP(wariant): the two looks on the board round - a: the person's lists
 * open in the box, b: the box leads down to them, open in „Listy wyborcze”. */
const wariant = computed<"a" | "b">(() =>
  route.query.wariant === "b" ? "b" : "a",
);
/** In b, the newest of the person's lists, open where the reader lands; the
 * box's links open the others. All of them open at once was Adam Struzik's
 * nine lists in Województwo mazowieckie, 14,600 px of page. */
const openListKeys = computed(() => {
  if (wariant.value !== "b") return [];
  const newest = personRuns.value.find((run) => run.list)?.list;
  return newest ? [newest.key] : [];
});

const kindOfRegion = computed(() => regionKind(regionTeryt.value));

/** Who governs the place, off the runs above (shared/regionAuthorities.ts). */
const authorities = computed(() =>
  type === "region" && node !== "teryt1261"
    ? regionAuthorities(
        electionRuns?.data.value?.runs ?? [],
        regionTeryt.value,
        electionRuns?.data.value?.hiddenElected,
      )
    : null,
);

/** Where a place that shows nobody sends the reader: its powiat's lists (a
 * gmina, whose runs the night files there - task
 * check-gmina-runs-sent-at-powiat-depth), its city's government (a city's
 * gmina twin) or its city's lists (a Warsaw district). Built from the TERYT
 * code, so a failed read of the name still leaves the way there. */
const pointerTarget = computed(() => {
  const pointer = authorities.value?.pointer;
  const code = regionTeryt.value;
  if (!pointer || !code) return undefined;
  const id = `teryt${code.slice(0, 4)}`;
  // Kraków's page is drawn by hand: its rada heads it, it has no „Władze”.
  const handDrawn = id === "teryt1261";
  const anchor =
    pointer === "miasto" && authorities.value?.kind !== "dzielnica"
      ? handDrawn
        ? ""
        : "#wladze"
      : "#listy-wyborcze";
  const councilOnly = handDrawn && pointer === "miasto";
  const above = regionAncestors.value.find((each) => each.id === id);
  return above
    ? { name: above.name, url: `${above.url}${anchor}`, councilOnly }
    : {
        url: `${nodeLinkUrl({ id, type: "region", name: "" })}${anchor}`,
        councilOnly,
      };
});

/** TEMP(wariant) wladze: the board round's looks of „Władze” - a, a row each
 * with the person's parties; b, names under their committee; c, a with
 * PKW's whole result (preview). */
const wladze = computed<"a" | "b" | "c">(() =>
  route.query.wladze === "b" || route.query.wladze === "c"
    ? route.query.wladze
    : "a",
);
/** TEMP(wariant) glowa=karta: the old card head, for the comparison crop. */
const glowa = computed(() => route.query.glowa);
/** TEMP(wariant) rodzaj=1: the trail ends on the kind of unit. */
const trailKind = computed(() => {
  if (!route.query.rodzaj || !regionTeryt.value) return undefined;
  const code = regionTeryt.value;
  if (code.length === 4) {
    return Number(code.slice(2)) >= 61
      ? "miasto na prawach powiatu"
      : undefined;
  }
  return (
    {
      "1": "gmina miejska",
      "2": "gmina wiejska",
      "3": "gmina miejsko-wiejska",
      "8": "dzielnica Warszawy",
    } as Record<string, string>
  )[code[6] ?? ""];
});

/** The region's name as its head and tab say it: a województwo stored by
 * its bare adjective („łódzkie”) reads „Województwo łódzkie”. */
const regionTitle = computed(() => {
  const name = entity.value?.name ?? "";
  return regionTeryt.value?.length === 2 ? wojewodztwoLabel(name) : name;
});

/** The companies a region seats or holds shares in, once each: a gmina that
 * does both has two edges to the company, and the row is its `owns` one. See
 * `onePerNode`. */
const subsidiaries = computed(() =>
  onePerNode(
    targets.value.filter(
      (e) =>
        (e.type === "owns" || e.type === "seat") && e.richNode.type == "place",
    ),
    ["owns", "seat"],
  ),
);

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
// A teaser names the person in the tab as the page does, and says what the
// page is: the reader is looking at a draft, not at what the site publishes.
const seoTitle = computed(
  () =>
    (seoEntity.value?.type === "region" ? regionTitle.value : undefined) ??
    seoEntity.value?.name ??
    (teaser.value
      ? `${teaser.value.name} - profil niezweryfikowany`
      : "Strona nieznaleziona"),
);
const seoDescription = computed(() =>
  seoEntity.value
    ? entityDescription(seoEntity.value, edges.value.length, edges.value)
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

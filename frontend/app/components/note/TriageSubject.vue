<template>
  <!-- Nothing at all rather than an empty frame. A note can hang off a node
       that resolves to no document - a proposal nobody kept - and a company
       with no relations would repeat only the name the card above gives.

       The site's section shell, as on the entity pages this record comes
       from: its head is a section head under the page's 40px title, where the
       hand-copied one here was 16/500 - quieter than the card text under
       it. -->
  <PageSection
    v-if="subject && (person || relations.length)"
    :title="person ? 'Kogo dotyczy notatka' : 'Czego dotyczy notatka'"
    :icon="entityIcon(subject.type)"
    data-testid="triage-subject"
  >
    <!-- The table's side panel - the one /admin/notatki opens on the same
         node - without the parts that are a job of their own: the map, the
         change proposal with its vote, and the note editor, which here would
         only list the note being judged a second time.

         The card frames the record only. The relations under it are a ruled
         list with a head and a frame of their own, and wrapped in this card
         too they drew a second hairline a pixel inside the first, with their
         head jammed against its edge. -->
    <div class="k-card mt-3">
      <CardExplorePerson
        v-if="person"
        :person="person"
        :region="undefined"
        :company="undefined"
        :work-locations="searchLocations"
      />
      <!-- The panel's own title for a node that is not a person, in the ink
           it settled on there - see `ExploreNodeDrawer` - and a size down: a
           registry name runs to sixty characters, which at the panel's
           `text-h5` went five lines deep on a phone. -->
      <v-card v-else class="ma-2" flat>
        <v-card-title class="text-wrap text-h6">
          <NuxtLink
            :to="generateEntityUrl(subject.type, subject.id, subject.name)"
            class="text-ink-sage"
            target="_blank"
          >
            {{ subject.name }}
          </NuxtLink>
        </v-card-title>
      </v-card>
    </div>

    <!-- A row opens its page in a new tab, as the name on the card does:
         leaving the queue would take its undo history with it. -->
    <CardEmploymentHistory
      :edges="relations"
      :company="company"
      :subject-published="subject.published === true"
      new-tab
      class="mt-6"
    />
  </PageSection>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { authFetch } from "~/composables/auth";
import { useEdges } from "~/composables/edges";
import { generateEntityUrl } from "~/composables/slugs";
import { employmentTowns } from "~/utils/companyLocation";
import { entityIcon } from "~/utils/entityIcon";
import type { Company, Node, PersonRich } from "~~/shared/model";

/** Who or what a note in the categorization queue is about, drawn under the
 * choices so that a reviewer on a phone can read it without leaving the queue.
 *
 * Only for a person or a company. The page decides that before mounting this,
 * because by the time this could look at the node both reads below are already
 * on their way. */
const props = defineProps<{ nodeId: string }>();

// Both reads at once, and the same two the table's side panel makes when a
// note's node is opened there: the node - `latest`, so that one only proposed
// so far still has a record to show - and the relations around it. Awaited
// here, which makes this an async component; the page gives it a `<Suspense>`
// of its own so that the card and the choices never wait on it.
const [{ data }, { sources, targets }] = await Promise.all([
  authFetch<{ node: Node }>(() => `/api/nodes/${props.nodeId}`, {
    query: { latest: "true" },
  }),
  useEdges(() => props.nodeId),
]);

/** The node with its id filled in from the note where the response leaves it
 * out, as the table does before handing a node to the panel. */
const subject = computed(() => {
  const node = data.value?.node;
  return node ? { ...node, id: node.id ?? props.nodeId } : undefined;
});

const person = computed(() =>
  subject.value?.type === "person"
    ? (subject.value as unknown as PersonRich)
    : undefined,
);

/** Handed to the relations so that a role reads as the institution calls it -
 * a hospital's „Rada społeczna" rather than the stored „Rada Nadzorcza". A
 * person's rows read it off the company at the far end of each instead. */
const company = computed(() =>
  subject.value?.type === "place"
    ? (subject.value as unknown as Company)
    : undefined,
);

const relations = computed(() => [...sources.value, ...targets.value]);

/** The towns to search the person in: where they stood for election, then
 * where their employers are. The person page's answer, off the relations
 * already fetched. The side panel reads the same thing out of the whole region
 * collection instead - over a megabyte, which a queue worked through on a phone
 * should not pay for a row of search buttons. */
const searchLocations = computed(() => [
  ...relations.value
    .filter((edge) => edge.type === "election" && edge.richNode?.name)
    .map((edge) => edge.richNode.name),
  ...employmentTowns(relations.value),
]);
</script>

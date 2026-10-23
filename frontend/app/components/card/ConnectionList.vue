<template>
  <!-- The site's section head, as over every other section of an entity
       page: on the heading's baseline, 8px over the list, with how many it
       holds as its caption where the page asks for one. -->
  <PageSection
    v-if="edges.length > 0 || canAdd"
    :title="title"
    :caption="countCaption"
  >
    <!-- The control tint, as the history's „Dodaj” on the same page
         (card/EmploymentHistory.vue): sage ink on white is 1.85:1 on this
         theme. -->
    <template v-if="canAdd" #actions>
      <v-btn
        variant="tonal"
        size="small"
        :prepend-icon="mdiPlus"
        :data-testid="`add-relation-${addTestid}`"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </template>
    <!-- A ruled list on the hairline, not a card lifted on a shadow; edge to
         edge on a phone, like the relation history. Only entity pages list
         these, at their full width. -->
    <v-card v-if="edges.length > 0" variant="flat" border class="k-bleed-xs">
      <v-list :id="listId" ref="list" density="compact">
        <v-list-item
          v-for="edge in shownEdges"
          :key="edge.richNode.id"
          :to="nodeLinkUrl(edge.richNode)"
          :prepend-icon="entityIcon(edge.richNode.type)"
        >
          <!-- Wrapped rather than cut: a registry name runs to sixty
               characters, and on a phone the ellipsis took the city with it.
               Bold, as an entity's name is in the history's rows and every
               other list of them; how many people it holds stays regular. -->
          <v-list-item-title class="text-wrap font-weight-bold">
            {{ edge.richNode.name }}
            <span
              v-if="getPeopleCount(edge) > 0"
              class="font-weight-regular text-medium-emphasis"
            >
              ({{ getPeopleCount(edge) }})
            </span>
          </v-list-item-title>

          <!-- Which sector the institution belongs to. The rows here are a
               company's owners and subsidiaries, or a region's institutions,
               and the sector is what tells a reader apart two registry names
               that differ by one word. Draws nothing for a row that is not a
               company. -->
          <ChipCompanyCategories :company="edgeCompany(edge)" />
          <!-- Whether the relation itself is live, and an admin's way to make
               it so. Beside the sector chip rather than in the append slot: the
               append slot is where the controls that take something away
               live. -->
          <ChipEdgeDraftStatus
            :edge-id="edge.id"
            :published="edge.visibility"
            :publishable="edgeIsPublishable(edge, subjectPublished)"
            @published="emit('published')"
          />

          <!-- Admins only. The row is a link to the other end, so this stops
               the click rather than letting it navigate away. -->
          <template v-if="edge.id && canRemove" #append>
            <v-btn
              variant="text"
              size="small"
              color="error"
              title="Usuń powiązanie"
              :icon="mdiTrashCanOutline"
              :data-testid="`edge-remove-${edge.id}`"
              @click.stop.prevent="emit('remove', edge)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
    <!-- An editor's empty list says so in the line for what a section lacks,
         so its head and „Dodaj” do not stand bare over the next section's
         head (Szymon, 2026-10-24). -->
    <p
      v-else-if="emptyText"
      class="k-note k-absent"
      data-testid="connections-empty"
    >
      {{ emptyText }}
    </p>
    <!-- The rest of a long list one click away, opened in place, and the
         button gone once it has: the bio's „Pokaż więcej”
         (EntityDetailsCard.vue). Only where the page asks for a fold, which
         it does for a reader who is not signed in: an admin's rows carry
         their controls, and none of those is ever a click away. A neutral
         text button, its label on the section's left edge (`ms-n2` hangs
         its padding into the gutter) and 44px tall for a finger. -->
    <v-btn
      v-if="folded"
      variant="text"
      height="44"
      class="px-2 ms-n2"
      :append-icon="mdiChevronDown"
      aria-expanded="false"
      :aria-controls="listId"
      :data-testid="`connections-more-${addTestid ?? 'list'}`"
      @click="unfold"
    >
      Pokaż wszystkie ({{ edges.length }})
    </v-btn>
  </PageSection>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  useId,
  useTemplateRef,
  type ComponentPublicInstance,
} from "vue";
import { mdiChevronDown, mdiPlus, mdiTrashCanOutline } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import {
  edgeCompany,
  edgeIsPublishable,
  type EdgeNode,
} from "~~/app/composables/edges";
import { nodeLinkUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";

const props = defineProps<{
  title: string;
  edges: EdgeNode[];
  /** Whether this section offers adding a relation of its own kind. */
  canAdd?: boolean;
  /** Suffix for the add button's test hook, since a page renders several of
   * these and they would otherwise be indistinguishable - and for the fold's
   * button, for the same reason. */
  addTestid?: string;
  /** Whether each row offers taking the relation off the graph outright, which
   * is an administrator's decision and nobody else's. */
  canRemove?: boolean;
  /** Whether the page these relations hang off is itself published. See the
   * same prop on `CardEmploymentHistory`. */
  subjectPublished?: boolean;
  /** The noun the head's caption counts the rows in - one, two to four,
   * five - as `polishCounting` takes it: „3 spółki”, „12 spółek”. No caption
   * without it, and none over an empty list, where the head and its „Dodaj”
   * are the whole section. */
  countNouns?: readonly [string, string, string];
  /** How many rows to show before „Pokaż wszystkie”. Left out, every row
   * shows, which is what a page asks for whenever somebody may act on them. */
  foldAfter?: number;
  /** What an empty list says to the reader who may add to it, in one quiet
   * line under the head: „Nie znamy spółek zależnych.” Left out, the head
   * and its „Dodaj” stand alone. */
  emptyText?: string;
}>();

const emit = defineEmits<{
  add: [];
  remove: [edge: EdgeNode];
  /** A row went live; the caller refetches if it draws the relation twice. */
  published: [];
}>();

function getPeopleCount(edge: EdgeNode) {
  const stats = edge.richNode.stats as
    | {
        nodeGroupSize?: number;
        people?: number;
      }
    | undefined;
  return stats?.nodeGroupSize ?? stats?.people ?? 0;
}

const edgesSorted = computed(() => {
  return [...props.edges].sort((a, b) => {
    const countDiff = getPeopleCount(b) - getPeopleCount(a);
    if (countDiff !== 0) return countDiff;
    return (a.richNode.name || "").localeCompare(b.richNode.name || "");
  });
});

/** „80 spółek”, beside the head. */
const countCaption = computed(() =>
  props.countNouns && props.edges.length > 0
    ? polishCounting(props.edges.length, ...props.countNouns)
    : undefined,
);

const unfolded = ref(false);

/** Whether the list stops at `foldAfter` rows. Never to hide a single row:
 * the button takes about the room that row would have. */
const folded = computed(
  () =>
    !unfolded.value &&
    props.foldAfter !== undefined &&
    edgesSorted.value.length > props.foldAfter + 1,
);

/** The rows drawn: the biggest first, as sorted, so a fold keeps the ones
 * holding the most people. */
const shownEdges = computed(() =>
  folded.value && props.foldAfter !== undefined
    ? edgesSorted.value.slice(0, props.foldAfter)
    : edgesSorted.value,
);

/** For the button to say what it opens, the same on the server and in the
 * browser. */
const listId = useId();
const list = useTemplateRef<ComponentPublicInstance>("list");

/** Opening the list takes the focused button away, which would drop a
 * keyboard or screen-reader user back to the top of the page. Focus goes to
 * the first row it opened instead - a link, so the next Tab carries on down
 * the list - without scrolling: the rows open downwards from where the reader
 * already is. */
async function unfold() {
  unfolded.value = true;
  await nextTick();
  const rows = (
    list.value?.$el as HTMLElement | undefined
  )?.querySelectorAll<HTMLElement>(".v-list-item");
  rows?.[props.foldAfter ?? 0]?.focus({ preventScroll: true });
}
</script>

<template>
  <!-- `d-inline-flex` rather than a bare chip: with the publish button beside
       it this is two things, and every caller drops it into a heading that lays
       its children out in a row. One element keeps the pair from being split
       across a wrap. -->
  <span v-if="visible" class="d-inline-flex align-center ga-1">
    <!-- The same `x-small` chip the rest of the site marks a draft with, in the
         warning pair from `shared/colors.ts` rather than the grey a row marker
         takes from `currentColor`. A page's own badge is worth the colour where
         a row's is not: there is exactly one of it, and what it says is that
         nothing else on the screen is public yet. `ink.warning` on
         `surface.warning` is 5.54:1. -->
    <v-chip
      size="x-small"
      variant="flat"
      class="bg-surface-warning font-weight-medium"
      data-testid="draft-status-chip"
    >
      szkic
      <v-tooltip activator="parent" location="bottom" max-width="280">
        Ta strona nie jest opublikowana - widzą ją tylko zalogowani użytkownicy.
      </v-tooltip>
    </v-chip>

    <!-- Publishing from the page that is the draft. Until now the only way in
         was /admin/rewizje/<id>, so the reviewer who had just read the page and
         made up their mind had to leave it to act on the decision. -->
    <v-btn
      v-if="canPublish"
      size="x-small"
      variant="text"
      color="primary"
      data-testid="draft-status-publish"
      @click="publishOpen = true"
    >
      Opublikuj
    </v-btn>
    <AdminPublishNodeDialog
      v-if="canPublish"
      v-model="publishOpen"
      :node-id="nodeId!"
      :node-name="nodeName"
      @published="onPublished"
      @failed="onFailed"
    />
  </span>

  <!-- Outside the badge, which unmounts the moment the page goes live - a
       message about a half-finished publication has to outlive the thing that
       reported it. -->
  <v-snackbar v-model="errorShown" color="error" :timeout="6000">
    {{ error }}
  </v-snackbar>
</template>

<script setup lang="ts">
/** Whether the page the reader is on is live, for the reader who can be on one
 * that is not.
 *
 * Draft pages 404 for everybody else, so this says nothing to a logged out
 * visitor - it would be a badge that can only ever appear on a page they cannot
 * load. It says nothing on a published page either: „opublikowane" on nine
 * pages in ten is a word repeated everywhere to mark the exception by its
 * absence, which is the reason /eksploruj/tabela dropped its „Widoczność"
 * column in favour of this same badge.
 */
import { computed, ref } from "vue";
import { useAuthState } from "~/composables/auth";

const props = withDefaults(
  defineProps<{
    /** The flag as the endpoint answered it. `undefined` counts as a draft:
     * every endpoint serving a page a reader can reach carries it, so a missing
     * one is a page that was never published rather than one whose state is
     * unknown. */
    published?: boolean;
    /** The node the publish action acts on. Without it the badge is
     * informational - which is what a preview of a proposed change is. */
    nodeId?: string;
    nodeName?: string | null;
  }>(),
  { published: undefined, nodeId: undefined, nodeName: undefined },
);

const emit = defineEmits<{
  /** The page went live from here. The caller owns the response this component
   * read `published` off, so refetching it is its call and not ours. */
  published: [];
}>();

const { user, isAdmin } = useAuthState();

/** Set when this session published the page. The response the caller read is
 * not refetched by us - and on the public path it is cached for six hours - so
 * without this the badge would sit there contradicting the dialog that just
 * closed. */
const justPublished = ref(false);

const visible = computed(
  () => !!user.value && !justPublished.value && props.published !== true,
);

const canPublish = computed(
  () => visible.value && isAdmin.value && !!props.nodeId,
);

const publishOpen = ref(false);
const error = ref("");
const errorShown = ref(false);

/** No confirmation message: the badge is the confirmation. It says „szkic"
 * before the click and is gone after it, on the page the reviewer is reading.
 * Which version went live, where the page had none approved, the dialog says
 * before the click rather than this saying it after - the caller refetches on
 * `published`, and a message that outlives that redraw by a moment is not one
 * anybody can rely on reading. */
function onPublished() {
  justPublished.value = true;
  emit("published");
}

/** A refusal. The page half and the relations half are not one transaction, so
 * the page can be live while this fires - and the badge has to agree with that
 * rather than keep saying „szkic". */
function onFailed({
  error: err,
  nodePublished,
}: {
  error: unknown;
  nodePublished: boolean;
}) {
  if (nodePublished) {
    justPublished.value = true;
    emit("published");
  }
  error.value = nodePublished
    ? "Strona została opublikowana, ale jej powiązania nie."
    : errorMessage(err);
  errorShown.value = true;
}

/** The server's own words where it gave any - what is left to refuse a
 * publication now is a page with no usable revision at all, and the sentence
 * saying so is more use than "nie udało się". */
function errorMessage(err: unknown): string {
  const data = (err as { data?: { message?: string } } | null)?.data;
  return (
    data?.message ||
    (err instanceof Error ? err.message : "") ||
    "Nie udało się opublikować strony."
  );
}
</script>

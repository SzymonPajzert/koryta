<template>
  <!-- One element around the pair, like `DraftStatus`: every caller drops this
       into a row that lays its children out horizontally, and the chip and the
       button must not be split across a wrap. -->
  <span v-if="visible" class="d-inline-flex align-center ga-1">
    <v-chip
      size="x-small"
      variant="flat"
      class="bg-surface-warning font-weight-medium"
      :data-testid="`edge-draft-chip-${edgeId ?? 'unknown'}`"
    >
      szkic
      <v-tooltip activator="parent" location="bottom" max-width="280">
        {{
          publishable
            ? "To powiązanie nie jest opublikowane - widzą je tylko zalogowani użytkownicy."
            : "To powiązanie nie jest opublikowane, i nie może być: jedna ze stron sama jest szkicem. Opublikuj najpierw tamtą stronę."
        }}
      </v-tooltip>
    </v-chip>

    <!-- The whole point of this component. Until now a relation added between
         two pages that are already live could only be published from
         /admin/krawedzie, a queue of several hundred rows ordered by document
         id - so the one relation the reviewer had just added was the hardest
         one there to find. `stop.prevent` because every row that mounts this is
         itself a link to the other end of the relation. -->
    <v-btn
      v-if="canPublish"
      size="x-small"
      variant="text"
      color="primary"
      :loading="publishing"
      :data-testid="`edge-draft-publish-${edgeId}`"
      @click.stop.prevent="publish"
    >
      Opublikuj
    </v-btn>
  </span>

  <!-- Outside the badge, which unmounts the moment the relation goes live - a
       refusal has to outlive the thing that reported it. -->
  <v-snackbar v-model="errorShown" color="error" :timeout="6000">
    {{ error }}
  </v-snackbar>
</template>

<script setup lang="ts">
/** Whether the relation a row draws is live, and the way to make it so.
 *
 * A node has `ChipDraftStatus` for this, and its publish dialog carries the
 * node's relations along with it - but only while the node is a draft, which is
 * exactly when the relations cannot be published. The moment the page goes live
 * the dialog is gone, and a relation added afterwards between two live pages
 * had nowhere to be published from except the queue at /admin/krawedzie: 498
 * eligible rows out of 28,547 unpublished relations in the 2026-09-09 export,
 * ordered by document id and 25 to a page. So the relation somebody had just
 * added by hand was the one they were least likely to find there.
 *
 * Silent for a logged out reader, who is never served an unpublished relation
 * in the first place, and silent on a published one - see `ChipDraftStatus` for
 * why marking the rule rather than the exception is the wrong way round.
 */
import { computed, ref } from "vue";
import { authRequest, useAuthState } from "~/composables/auth";

const props = withDefaults(
  defineProps<{
    /** The relation's id. Without it the badge is informational: the rows drawn
     * from a revision preview have no stored edge to act on. */
    edgeId?: string;
    /** The flag as the graph answered it (`visibility`, which is
     * `pageIsPublic` of the stored edge). `undefined` counts as a draft, on the
     * same reasoning `ChipDraftStatus` gives. */
    published?: boolean;
    /** Whether both ends of the relation are themselves live, which is the
     * rule `/api/edges/publish` enforces. False renders the badge without the
     * button, rather than a button whose only outcome is a refusal.
     *
     * Defaults to true so that a surface which cannot work it out offers the
     * action and lets the server have the last word - the check is a courtesy,
     * and the endpoint re-runs it against data this cannot see anyway. */
    publishable?: boolean;
  }>(),
  { edgeId: undefined, published: undefined, publishable: true },
);

const emit = defineEmits<{
  /** The relation went live from here. The caller owns the response this read
   * `published` off, so refetching it is its call and not ours. */
  published: [];
}>();

const { user, isAdmin } = useAuthState();

/** Set when this session published the relation. The list this row came from is
 * not refetched by us - and the caller may not refetch at all - so without this
 * the badge would sit there contradicting the click that just succeeded. */
const justPublished = ref(false);

const visible = computed(
  () => !!user.value && !justPublished.value && props.published !== true,
);

const canPublish = computed(
  () => visible.value && isAdmin.value && !!props.edgeId && props.publishable,
);

const publishing = ref(false);
const error = ref("");
const errorShown = ref(false);

async function publish() {
  if (!props.edgeId || publishing.value) return;
  publishing.value = true;
  try {
    await authRequest("/api/edges/publish", {
      body: { edge_ids: [props.edgeId], published: true },
    });
    justPublished.value = true;
    emit("published");
  } catch (err) {
    error.value = errorMessage(err);
    errorShown.value = true;
  } finally {
    publishing.value = false;
  }
}

/** The server's own words where it gave any: what refuses a publication here is
 * a rule about the two pages at the ends, and the sentence naming the one that
 * is still a draft is more use than „nie udało się". */
function errorMessage(err: unknown): string {
  const data = (err as { data?: { message?: string } } | null)?.data;
  return (
    data?.message ||
    (err instanceof Error ? err.message : "") ||
    "Nie udało się opublikować powiązania."
  );
}
</script>

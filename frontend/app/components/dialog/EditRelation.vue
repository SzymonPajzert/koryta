<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card data-testid="edit-relation-dialog">
      <v-card-title class="pb-1">Popraw powiązanie</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        {{ edgeLabel }}
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <!-- Said before the fields rather than after the save, because it is
             what decides whether somebody bothers: a contributor's correction
             waits for a reviewer, and an admin's is live the moment they
             click. -->
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{
            canApply
              ? "Zmiana wchodzi od razu - zatwierdzasz ją sam/a."
              : "Zmiana trafi do zatwierdzenia. Do tego czasu strona pokazuje to, co teraz."
          }}
          Kogo powiązanie łączy i jakiego jest rodzaju, tu się nie zmienia - do
          tego służy usunięcie i dodanie właściwego.
        </p>

        <FormRelationDetailFields
          v-model="details"
          :real-type="edge?.type"
          prefix="edit-relation"
        />

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="edit-relation-error"
        >
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="saving"
          :disabled="!readyToSubmit"
          data-testid="edit-relation-submit"
          @click="submit()"
        >
          {{ canApply ? "Zapisz zmianę" : "Zaproponuj zmianę" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Correcting what one relation says, from the row that says it.
 *
 * The complaint this answers is that a person's „Zaproponuj zmianę” edits their
 * name, their party and their links, and the employments underneath - which are
 * most of what the page actually claims - could not be touched at all. So the
 * entry point is the row: whichever relation is wrong is the one with the
 * pencil on it.
 *
 * Only what the relation says is editable, not who it joins. `/api/edges/update`
 * refuses the ends and the type for the same reason, and the paragraph above
 * the fields says so - moving an end turns a wrong claim into a different one,
 * and the honest version of that is a removal and an addition, each with its
 * own record.
 *
 * One dialog per page rather than one per row, like `DialogRemoveEdge`: a
 * person with fifty relations would otherwise mount fifty of them. Pair it with
 * `useEdgeEditing`, which owns the state, and `DialogEditRelationHost`, which
 * binds this and its notice in one tag.
 */
import { computed, ref, watch } from "vue";
import { authRequest } from "~/composables/auth";
import type { EdgeNode } from "~/composables/edges";
import type { RelationDetails } from "~/components/form/RelationDetailFields.vue";
import { relationDateRule } from "~/utils/relationDate";
import type { EdgeUpdated } from "~~/server/api/edges/update.post";

const props = defineProps<{
  modelValue: boolean;
  /** The relation on screen. Undefined until somebody clicks a pencil, which is
   * what keeps a page from fetching for nothing. */
  edge: EdgeNode | undefined;
  /** How the relation reads on the page it was opened from - see
   * `edgeSentence` - so the dialog says which row is being corrected. */
  edgeLabel: string;
  /** Whether this reader's edit applies at once or joins the review queue. The
   * server decides it either way; this is only what the dialog promises. */
  canApply?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** Saved. `applied` is false when it went to the queue instead, so the caller
   * knows whether refetching will show anything new. */
  saved: [applied: boolean];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const saving = ref(false);
const error = ref<string | null>(null);

const details = ref<RelationDetails>(emptyDetails());

function emptyDetails(): RelationDetails {
  return { name: "", start_date: "", end_date: "", party: "", committee: "" };
}

/** The relation's own name, not the label the row prints.
 *
 * `EdgeNode.label` falls back to the edge type's Polish phrase when the edge
 * has no name of its own ("Zatrudniony/a w"), so prefilling from it would offer
 * that phrase back as the job title and store it as one on the first save. */
function detailsOf(edge: EdgeNode | undefined): RelationDetails {
  if (!edge) return emptyDetails();
  return {
    name: edge.name ?? "",
    start_date: edge.start_date ?? "",
    end_date: edge.end_date ?? "",
    party: edge.party ?? "",
    committee: edge.committee ?? "",
  };
}

// Prefilled from the row every time it opens, so that somebody who opens a
// relation, types into it and cancels does not find their abandoned text
// waiting on the next one.
//
// `immediate`, and watching the edge as well as the flag, because the host
// mounts this only once a row has been clicked - `v-if="edge?.id"` - by which
// point the flag is already true. Watching the flag alone meant the watcher
// never ran at all and the form opened empty, which on save would have blanked
// every field of the relation it was meant to correct.
watch(
  [open, () => props.edge],
  ([isOpen]) => {
    if (!isOpen) return;
    details.value = detailsOf(props.edge);
    error.value = null;
  },
  { immediate: true },
);

const readyToSubmit = computed(
  () =>
    !!props.edge?.id &&
    !saving.value &&
    relationDateRule(details.value.start_date) === true &&
    relationDateRule(details.value.end_date) === true,
);

async function submit() {
  if (!readyToSubmit.value) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await authRequest<EdgeUpdated>("/api/edges/update", {
      body: { edge_id: props.edge!.id, ...details.value },
    });
    open.value = false;
    emit("saved", result.applied);
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się zapisać zmiany.";
  } finally {
    saving.value = false;
  }
}
</script>

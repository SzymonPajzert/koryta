<template>
  <DialogEditRelation
    v-if="edge?.id"
    v-model="open"
    :edge="edge"
    :edge-label="label"
    :can-apply="canApply"
    @saved="emit('saved', $event)"
  />

  <v-snackbar
    :model-value="!!outcome"
    color="info"
    :timeout="6000"
    @update:model-value="outcome = undefined"
  >
    {{
      outcome === "applied"
        ? "Powiązanie poprawione."
        : "Poprawka zapisana i czeka na zatwierdzenie."
    }}
  </v-snackbar>
</template>

<script setup lang="ts">
/** The correction dialog and the notice that follows it, as one tag.
 *
 * The twin of `DialogRemoveEdgeHost`, and there for the same reason: four hosts
 * draw the same relations card, and pasting the same dozen lines into each is
 * how they drift - one loses the notice, or promises a saved change on a page
 * where it really went to a queue, and no test looks at all four. Pair it with
 * `useEdgeEditing`, which owns the state this binds to.
 */
import type { EdgeNode } from "~/composables/edges";

const open = defineModel<boolean>({ required: true });
/** Which notice is up, if any. Its own model, because the dialog closes before
 * the notice appears - they are never one flag - and because the wording
 * depends on whether the edit was applied or filed. */
const outcome = defineModel<"applied" | "proposed" | undefined>("outcome", {
  required: true,
});

defineProps<{
  /** The relation on screen. Undefined until somebody clicks a pencil. */
  edge: EdgeNode | undefined;
  /** The relation read as a sentence - see `edgeSentence`. */
  label: string;
  /** Whether this reader's edit applies at once. */
  canApply?: boolean;
}>();

const emit = defineEmits<{ saved: [applied: boolean] }>();
</script>

<template>
  <template v-if="rule">
    <!-- What a confirmed fact is *for*. Voting a fact correct used to lead
         nowhere: nothing reads the verdict, and recording what the fact said
         meant retyping it into the edge form on somebody else's page. -->
    <v-btn
      v-if="!done"
      size="small"
      variant="text"
      color="primary"
      :prepend-icon="mdiVectorLink"
      data-testid="extraction-promote"
      @click="open = true"
    >
      Utwórz powiązanie
    </v-btn>
    <!-- In the button's place once the fact is a relation, for whoever comes
         next: the far end is picked by hand, so a second reader promoting it
         again could just as well pick a different node and leave two
         relations saying one thing. Text rather than a disabled button, which
         reads as "not allowed" rather than "done". -->
    <span
      v-else
      class="extraction-promoted text-caption d-inline-flex align-center ga-1"
      data-testid="extraction-promoted"
    >
      <v-icon :icon="mdiCheck" size="16" />
      Powiązanie utworzone
      <v-tooltip activator="parent" location="bottom" max-width="280">
        Ten fakt jest już powiązaniem w bazie - jest w „Historii powiązań” na
        stronie osoby. Zanim stanie się publiczne, zatwierdza je administrator.
      </v-tooltip>
    </span>

    <ExtractionPromoteDialog
      v-model="open"
      :fact="fact"
      :rule="rule"
      @promoted="onPromoted"
    />
  </template>
</template>

<script setup lang="ts">
/** „Utwórz powiązanie” for one fact: the button, the dialog behind it, and
 * what the button becomes once the fact is a relation.
 *
 * Draws nothing for a fact that cannot become one - nobody matched, or a kind
 * of fact with no relation type to become (see `factEdgeRule`) - so a caller
 * can mount it on every fact and ask `factEdgeRule` only when it has to lay
 * out a row around it.
 */
import { computed, ref } from "vue";
import { mdiCheck, mdiVectorLink } from "@mdi/js";
import { factEdgeRule } from "~/utils/extraction";
import { ExtractionPromoteDialog } from "#components";
import type { ExtractionFact } from "~~/shared/model";

const { fact } = defineProps<{
  /** The fact being promoted: its person is the relation's source, its role
   * the relation's name, its article the relation's source document. */
  fact: ExtractionFact;
}>();

const emit = defineEmits<{
  /** The fact now stands for this relation. */
  promoted: [edgeId: string];
}>();

const open = ref(false);

/** How this fact would become an edge, when it can become one at all. */
const rule = computed(() => factEdgeRule(fact));

/** Set when this button made the fact a relation. The list the fact came from
 * is not refetched here, so without it the button would come back until the
 * page is reloaded. */
const justPromoted = ref(false);

/** Whether the fact already stands for a relation - recorded on the document
 * by /api/edges/create for everybody, or made from here a moment ago. */
const done = computed(
  () => justPromoted.value || (fact.promotedEdgeIds?.length ?? 0) > 0,
);

function onPromoted(edgeId: string) {
  justPromoted.value = true;
  emit("promoted", edgeId);
}
</script>

<style scoped>
/* Done rather than offered: the ink „W Twojej notatce” settles into, at the
   height of the button it replaces so the row does not move. */
.extraction-promoted {
  color: rgb(var(--v-theme-ink-success));
  min-height: 28px;
  padding-inline: 8px;
}
</style>

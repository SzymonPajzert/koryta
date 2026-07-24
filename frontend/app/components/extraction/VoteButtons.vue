<template>
  <client-only>
    <div class="d-inline-flex align-center ga-1">
      <v-btn
        icon
        size="small"
        color="error"
        :variant="correctVote < 0 ? 'tonal' : 'text'"
        @click="setCorrect(correctVote < 0 ? 0 : -1)"
      >
        <v-icon size="22">{{ mdiCloseCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top">
          Niepoprawny fakt
        </v-tooltip>
      </v-btn>

      <v-btn
        icon
        size="small"
        color="warning"
        :variant="insufficientVote > 0 ? 'tonal' : 'text'"
        @click="setInsufficient(insufficientVote > 0 ? 0 : 1)"
      >
        <v-icon size="22">{{ mdiHelpCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top">
          Za mało informacji
        </v-tooltip>
      </v-btn>

      <v-btn
        icon
        size="small"
        color="success"
        :variant="correctVote > 0 ? 'tonal' : 'text'"
        @click="setCorrect(correctVote > 0 ? 0 : 1)"
      >
        <v-icon size="22">{{ mdiCheckCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top"> Poprawny fakt </v-tooltip>
      </v-btn>
    </div>
  </client-only>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { useVotes } from "~/composables/votes";
import { ClientOnly } from "#components";

const { id } = defineProps<{
  id: string;
}>();

// Both categories live in the same vote document; two subscriptions to the
// same doc are cheap (vuefire shares the underlying listener).
const correct = useVotes(id, "correct");
const insufficient = useVotes(id, "insufficient");

const correctVote = computed(
  () => correct.userCategoryVotes.value.correct || 0,
);
const insufficientVote = computed(
  () => insufficient.userCategoryVotes.value.insufficient || 0,
);

// castVote applies a delta, so aim it at the target value.
function setCorrect(target: number) {
  correct.castVote(target - correctVote.value);
}

function setInsufficient(target: number) {
  insufficient.castVote(target - insufficientVote.value);
}
</script>

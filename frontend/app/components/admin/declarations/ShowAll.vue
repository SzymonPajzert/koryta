<template>
  <v-btn
    v-if="total > limit"
    variant="text"
    size="small"
    :append-icon="showAll ? mdiChevronUp : mdiChevronDown"
    data-show-all
    @click="showAll = !showAll"
  >
    {{ showAll ? "Zwiń" : `Pokaż wszystkie (${formatCount(total)})` }}
  </v-btn>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { formatCount } from "~/utils/chartTheme";

/** The button in the head of a list that starts folded to its first rows, on
 * /admin/oswiadczenia. Nothing to unfold, no button. */
defineProps<{ total: number; limit: number }>();

const showAll = defineModel<boolean>({ default: false });
</script>

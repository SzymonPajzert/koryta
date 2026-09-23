<template>
  <v-chip
    size="small"
    variant="tonal"
    :color="row.isSelf ? 'ink-sage' : undefined"
    class="contributor-name"
  >
    <template #prepend>
      <v-avatar v-if="row.photoURL" start :image="row.photoURL" />
      <v-icon v-else start size="small" :icon="icon" />
    </template>
    <span class="text-truncate" style="max-width: 180px">{{ row.name }}</span>
    <span v-if="row.isSelf" class="ml-1 font-weight-medium">· Ty</span>
    <v-tooltip activator="parent" location="bottom" :text="explanation" />
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  contributorNameExplanation,
  contributorNameIcon,
  type ContributorNameRow,
} from "~/utils/contributorName";

/** One name in the public ranking, as far as the reader is allowed to see it.
 *
 * Deliberately not `UserChip`: that one takes a uid and resolves it through the
 * admin-only lookup, which is exactly the thing a public ranking must not do.
 * Everything shown here arrived on the row already decided by the server, so
 * there is no identity to fetch and nothing to fall back to.
 *
 * Only the fields it draws, so an actor from `/api/activity/feed` - decided by
 * the server the same way - fits as well as a ranking row. What the name says
 * about itself lives in `utils/contributorName`, which the feed shares.
 */
const props = defineProps<{
  row: ContributorNameRow;
  /** The reader is an administrator, shown every name whatever its owner
   * chose. */
  identified?: boolean;
}>();

const icon = computed(() => contributorNameIcon(props.row));

const explanation = computed(() =>
  contributorNameExplanation(props.row, props.identified),
);
</script>

<style scoped>
/* The masked rows are the majority, and a table of them should read as a
   ranking rather than as a wall of redactions. */
.contributor-name {
  font-variant-numeric: tabular-nums;
}
</style>

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
import { mdiAccountCircle, mdiEyeOffOutline } from "@mdi/js";
import type { ActivityContributor } from "~~/server/api/stats/activity.get";

/** One name in the public ranking, as far as the reader is allowed to see it.
 *
 * Deliberately not `UserChip`: that one takes a uid and resolves it through the
 * admin-only lookup, which is exactly the thing a public ranking must not do.
 * Everything shown here arrived on the row already decided by the server, so
 * there is no identity to fetch and nothing to fall back to.
 *
 * Only the fields it draws, so an actor from `/api/activity/feed` - decided by
 * the server the same way - fits as well as a ranking row.
 */
const props = defineProps<{
  row: Pick<
    ActivityContributor,
    "name" | "named" | "isSelf" | "photoURL" | "publicName"
  >;
  /** The reader is an administrator, who is shown every name whatever its
   * owner chose - so "agreed to be shown" would be a claim about somebody who
   * may never have. */
  identified?: boolean;
}>();

/** Whether everybody else sees the name on this chip. For your own row that
 * is `publicName`, not `named`: your name is shown to you whatever the setting,
 * and "visible to everyone" over a name the others see masked is a false
 * statement about your privacy. `named` stands in for a row sent without it. */
const shownToOthers = computed(() =>
  props.row.isSelf
    ? (props.row.publicName ?? props.row.named)
    : props.row.named,
);

const icon = computed(() =>
  shownToOthers.value ? mdiAccountCircle : mdiEyeOffOutline,
);

const explanation = computed(() => {
  if (props.row.isSelf) {
    return shownToOthers.value
      ? "To Ty. Twoja nazwa jest widoczna dla wszystkich."
      : "To Ty. Inni widzą w tym miejscu zamazaną nazwę — możesz to zmienić w swoim profilu.";
  }
  if (props.identified && props.row.named) {
    return "Widzisz tę nazwę jako administrator. Inni widzą ją tylko wtedy, gdy ta osoba włączyła to w profilu.";
  }
  return props.row.named
    ? "Ta osoba zgodziła się, żeby jej nazwa była widoczna publicznie."
    : "Ta osoba nie pokazuje swojej nazwy publicznie.";
});
</script>

<style scoped>
/* The masked rows are the majority, and a table of them should read as a
   ranking rather than as a wall of redactions. */
.contributor-name {
  font-variant-numeric: tabular-nums;
}
</style>

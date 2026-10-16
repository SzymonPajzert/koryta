<template>
  <v-chip v-if="uid" size="small" variant="tonal" class="user-chip">
    <template #prepend>
      <!-- An address that does not load (an expired Google photo) draws the
           icon, not an empty disc. -->
      <v-avatar v-if="info?.photoURL && !avatarFailed" start>
        <v-img :src="info.photoURL" alt="" cover @error="avatarFailed = true" />
      </v-avatar>
      <v-icon v-else start :icon="mdiAccountCircle" size="small" />
    </template>
    <span class="text-truncate" style="max-width: 180px">{{ name }}</span>
    <v-tooltip activator="parent" location="bottom">
      {{ uid }}<template v-if="info?.email"> · {{ info.email }}</template>
    </v-tooltip>
  </v-chip>
  <span v-else class="text-medium-emphasis">Nieznany</span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiAccountCircle } from "@mdi/js";
import { useUserLookup, type LookedUpUser } from "@/composables/users";

const props = defineProps<{
  uid?: string | null;
  /** Display data the caller already has.
   *
   * An endpoint that ranks or lists people resolves their names server-side in
   * one batch; passing the result in skips the chip's own lookup, which would
   * otherwise re-ask for names the page is already holding. */
  user?: LookedUpUser | null;
}>();

const { cache, resolve, displayName } = useUserLookup();

watch(
  () => [props.uid, props.user] as const,
  ([uid, user]) => {
    if (!user) resolve([uid]);
  },
  { immediate: true },
);

const info = computed(
  () => props.user ?? (props.uid ? cache.value[props.uid] : null),
);
const name = computed(
  () => props.user?.displayName || props.user?.email || displayName(props.uid),
);

const avatarFailed = ref(false);
watch(
  () => info.value?.photoURL,
  () => {
    avatarFailed.value = false;
  },
);
</script>

<style scoped>
/* Vuetify's chip content will not shrink below its text, so in a narrow
 * column - a fact in an open row is ~165px - a long name was cut mid-letter
 * with its ellipsis outside the chip. Let it shrink, and the name's own
 * `text-truncate` ends it inside. */
.user-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
}
</style>

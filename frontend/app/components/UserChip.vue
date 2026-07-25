<template>
  <v-chip v-if="uid" size="small" variant="tonal" class="user-chip">
    <template #prepend>
      <v-avatar v-if="info?.photoURL" start :image="info.photoURL" />
      <v-icon v-else start :icon="mdiAccountCircle" size="small" />
    </template>
    <span class="text-truncate" style="max-width: 180px">{{ name }}</span>
    <v-tooltip activator="parent" location="bottom">
      {{ uid }}<template v-if="info?.email"> · {{ info.email }}</template>
    </v-tooltip>
  </v-chip>
  <span v-else class="text-grey">Nieznany</span>
</template>

<script setup lang="ts">
import { mdiAccountCircle } from "@mdi/js";
import { useUserLookup } from "@/composables/users";

const props = defineProps<{
  uid?: string | null;
}>();

const { cache, resolve, displayName } = useUserLookup();

watch(
  () => props.uid,
  (uid) => resolve([uid]),
  { immediate: true },
);

const info = computed(() => (props.uid ? cache.value[props.uid] : null));
const name = computed(() => displayName(props.uid));
</script>

<template>
  <span class="chip" :style>
    {{ props.party }}
  </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {usePartyStatistics} from '@/composables/party'
const { parties, partyColors } = usePartyStatistics();

const props = defineProps<{
  party: string
}>();

const style = computed(() => {
  const partyID = parties.value.findIndex((x) => x === props.party);
  let color: string;
  if (partyID === -1) {
    color = 'white';
  } else {
    color = partyColors.value[partyID];
  }
  return {
    backgroundColor: color,
  };
});
</script>

<style scoped>
.chip {
  padding: 0.1rem 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.3rem;
  font-weight: 550;
  color: #090707;
}
</style>

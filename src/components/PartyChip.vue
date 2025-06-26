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
  return {
    backgroundColor: partyColors.value[props.party],
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

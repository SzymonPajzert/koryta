<template>
  <div>
    <span class="chip" :style>
      {{ party }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { partyColors } from "~~/shared/misc";

const partyFontColor: Record<string, string> = {
  PiS: "#fff",
  PO: "#fff",
  "Nowa Lewica": "#fff",
};

const { party } = defineProps<{
  party: string;
}>();

const style = computed(() => {
  return {
    backgroundColor: partyColors[party],
    color: partyFontColor[party] ?? "#090707",
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
}
</style>

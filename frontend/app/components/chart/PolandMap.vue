<script setup lang="ts">
import { computed, ref } from "vue";
import powiatyPaths from "@/assets/poland_powiaty.json";

const router = useRouter();

type Powiat = { teryt: string; d: string; original_id?: string };

const hoveredDistrict = ref<Powiat | null>(null);

const powiaty = computed(() => {
  return powiatyPaths.map((p) => ({
    ...p,
    id: p.teryt,
  }));
});

const hover = (region: Powiat) => {
  hoveredDistrict.value = region;
};

// TODO enable emit
// const emit = defineEmits(["click", "update:hovered"]);
// below:   emit("click", region);
const click = (region: Powiat) => {
  // TODO use the link from the stats - some don't have regular teryt code
  router.push(`/entity/place/teryt${region.teryt}`);
};

const getFillColor = (item: Powiat) => {
  // TODO add color based on the number of people
  if (hoveredDistrict.value?.teryt === item.teryt) {
    return "#e0e0e0";
  }
  return "#fff6d5";
};
</script>

<template>
  <div class="poland-map-container relative">
    <svg
      viewBox="0 0 800 744"
      xmlns="http://www.w3.org/2000/svg"
      class="w-full h-auto max-w-[800px] mx-auto"
    >
      <g>
        <path
          v-for="item in powiaty"
          :key="item.teryt"
          :d="item.d"
          :fill="getFillColor(item)"
          stroke="#333333"
          stroke-width="1"
          class="transition-colors duration-200 cursor-pointer hover:brightness-95"
          @mouseenter="hover(item)"
          @click="click(item)"
        >
          <title>{{ item.teryt }}</title>
        </path>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.poland-map-container {
  width: 100%;
}
</style>

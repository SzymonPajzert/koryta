<script setup lang="ts">
import { computed, ref } from "vue";
import voivodeshipPaths from "@/assets/poland_voivodeships.json";

const router = useRouter();

type Voivodeship = { teryt: string; d: string; original_id: string };

const hoveredDistrict = ref<Voivodeship | null>(null);

const voivodeships = computed(() => {
  return voivodeshipPaths.map((p) => ({
    ...p,
    id: p.teryt,
  }));
});

const hover = (region: Voivodeship) => {
  console.log("Clicked region:", region);
  hoveredDistrict.value = region;
};

// TODO enable emit
// const emit = defineEmits(["click", "update:hovered"]);
// below:   emit("click", region);
const click = (region: Voivodeship) => {
  // TODO use the link from the stats - some don't have regular teryt code
  router.push(`/entity/place/teryt${region.teryt}`);
};

const getFillColor = (item: Voivodeship) => {
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
      viewBox="240 180 480 360"
      xmlns="http://www.w3.org/2000/svg"
      class="w-full h-auto max-w-[800px] mx-auto"
    >
      <g transform="matrix(0.13333333,0,0,-0.13333333,0,720)">
        <path
          v-for="item in voivodeships"
          :key="item.teryt"
          :d="item.d"
          :fill="getFillColor(item)"
          stroke="#333333"
          stroke-width="5"
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

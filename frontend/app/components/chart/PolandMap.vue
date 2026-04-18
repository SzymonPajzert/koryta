<script setup lang="ts">
import { computed, ref } from "vue";
import powiatyPaths from "@/assets/poland_powiaty.json";
import type { Powiat } from "@/composables/entity/regions";
import { authFetch } from "@/composables/auth";

const hoveredDistrict = ref<Powiat | null>(null);

const { data: nodeGroups } = await authFetch("/api/graph/nodeGroups", {
  lazy: true,
  default: () => [],
});

const hover = (region: Powiat | null) => {
  hoveredDistrict.value = region;
};

const groupData = computed(() => {
  const map: Record<string, { id: string; people?: number; name?: string }> =
    {};
  for (const g of nodeGroups.value || []) {
    map[g.id] = g;
  }
  return map;
});

const powiaty = computed(() => {
  let maxPeople = 1;
  const list = powiatyPaths.map((p) => {
    const paddedTeryt = p.teryt.padStart(4, "0");
    const terytId = "teryt" + paddedTeryt;
    const group =
      groupData.value[terytId] ||
      groupData.value[p.teryt] ||
      groupData.value[paddedTeryt];
    const people = group?.people || 0;
    const name = group?.name || `Powiat ${paddedTeryt}`;

    if (people > maxPeople) {
      maxPeople = people;
    }

    return {
      ...p,
      id: p.teryt,
      people,
      name,
    };
  });
  return { list, maxPeople };
});
const emit = defineEmits(["click", "update:hovered"]);
const click = (region: Powiat) => {
  emit("click", region);
};

const getFillColor = (item: Powiat) => {
  if (hoveredDistrict.value?.teryt === item.teryt) {
    return "#e0e0e0";
  }
  if (!item.people || item.people === 0) {
    return "#fff6d5";
  }

  const ratio = item.people / powiaty.value.maxPeople;
  const opacity = 0.2 + 0.8 * ratio;

  return `rgba(204, 0, 0, ${opacity})`;
};
</script>

<template>
  <div class="poland-map-container relative">
    <svg
      viewBox="0 0 800 744"
      xmlns="http://www.w3.org/2000/svg"
      class="w-full h-auto max-w-[800px] mx-auto"
      @mouseleave="hover(null)"
    >
      <g>
        <path
          v-for="item in powiaty.list"
          :key="item.teryt"
          :d="item.d"
          :fill="getFillColor(item)"
          stroke="#333333"
          stroke-width="1"
          class="transition-colors duration-200 cursor-pointer hover:brightness-95"
          @mouseenter="hover(item)"
          @click="click(item)"
        >
          <title>{{ item.name }} ({{ item.people || 0 }} osób)</title>
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

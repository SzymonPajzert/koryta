<template>
  <div data-testid="region-workplace">
    <div class="text-caption text-medium-emphasis mb-1">
      Gdzie dokładnie w: <strong>{{ regionName }}</strong>
    </div>
    <v-progress-linear
      v-if="loading"
      indeterminate
      color="primary"
      class="mb-2"
      data-testid="region-workplace-loading"
    />
    <v-alert
      v-else-if="failed"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      Nie udało się sprawdzić, jaki urząd prowadzi ten region. Możesz wyszukać
      go poniżej.
    </v-alert>

    <v-radio-group
      v-model="picked"
      hide-details
      density="compact"
      class="mt-0"
      data-testid="region-workplace-options"
    >
      <template v-for="office in offices" :key="office.regon">
        <div
          v-if="office === firstGmina"
          class="text-caption text-medium-emphasis mt-2"
          data-testid="region-workplace-gminy"
        >
          Urzędy gmin w tym powiecie
        </div>
        <v-radio
          :value="office.regon"
          :data-testid="`region-workplace-office-${office.regon}`"
        >
          <template #label>
            <div class="py-1">
              <div v-if="office.gmina" class="text-body-2 font-weight-medium">
                {{ office.gmina }}
              </div>
              <div :class="office.gmina ? 'text-caption' : 'text-body-2'">
                {{ office.node?.name ?? office.name }}
              </div>
              <div class="text-caption text-medium-emphasis">
                REGON {{ office.regon }} ·
                {{
                  office.node
                    ? "już jest w bazie"
                    : "dodamy go do bazy razem z tym powiązaniem"
                }}
              </div>
            </div>
          </template>
        </v-radio>
      </template>
      <v-radio
        :value="OTHER"
        label="Inna jednostka podległa (np. MOPS, zarząd dróg, spółka)"
        data-testid="region-workplace-other"
      />
    </v-radio-group>

    <!-- The region search only knows the gminy the site has a node for, which
         is a minority of them; a powiat lists every one of its gminy's urzędy
         above, so it is the way to the rest. -->
    <div
      v-if="!loading && !firstGmina"
      class="text-caption text-medium-emphasis mt-1"
      data-testid="region-workplace-powiat-hint"
    >
      Nie ma gminy na liście regionów? Wybierz jej powiat - pokażemy urzędy
      wszystkich jego gmin.
    </div>

    <FormEntityPicker
      v-if="picked === OTHER"
      v-model="place"
      entity="place"
      label="Wyszukaj jednostkę"
      hint="Nową dodamy z siedzibą w tym regionie"
      persistent-hint
      density="comfortable"
      class="mt-2"
      data-testid="region-workplace-place"
      @created="onCreated"
    />
  </div>
</template>

<script setup lang="ts">
/** Which institution a post "in" a region was held in: the region's urząd, or a
 * unit under it.
 *
 * A person is employed by an office, not by a gmina, so the relation dialog
 * cannot store the region it was handed as the far end of an `employed` edge.
 * This asks the one question that turns the region into a place - offering
 * the urząd the register names for it first, since that is where a wójt, a
 * burmistrz, a prezydent or their deputy works, and a search over every place
 * for anything else the gmina runs. A powiat offers the urzędy of its gminy
 * after its own, since most gminy have no region to pick.
 */
import { computed, ref, watch } from "vue";
import type { Link, NodeType } from "~~/shared/model";
import type { RegionOfficeOption, RegionOffices } from "~~/shared/offices";
import { authRequest } from "~/composables/auth";

export type RegionWorkplace =
  | { office: RegionOfficeOption }
  /** `created` when the place was proposed from this picker just now, which
   * is what says it still needs a seat in the region. */
  | { place: Link<NodeType>; created: boolean };

const props = defineProps<{
  regionId: string;
  regionName: string;
}>();

const model = defineModel<RegionWorkplace | undefined>();

/** The radio value for "somewhere else", which no REGON can be. */
const OTHER = "other";

const offices = ref<RegionOfficeOption[]>([]);
const loading = ref(false);
const failed = ref(false);
const picked = ref<string | undefined>(undefined);
const place = ref<Link<NodeType> | undefined>(undefined);
const createdIds = ref(new Set<string>());

async function load(regionId: string) {
  loading.value = true;
  failed.value = false;
  offices.value = [];
  picked.value = undefined;
  place.value = undefined;
  try {
    const response = await authRequest<RegionOffices>(
      `/api/nodes/${encodeURIComponent(regionId)}/offices`,
      { method: "GET" },
    );
    // Asked for one region and answered for it: a slow answer for the region
    // picked before this one must not replace this one's.
    if (regionId !== props.regionId) return;
    offices.value = response.offices;
  } catch (e) {
    console.error("Failed to load the region's offices", e);
    if (regionId === props.regionId) failed.value = true;
  } finally {
    if (regionId === props.regionId) {
      loading.value = false;
      // The urząd when there is exactly one, which is every gmina: it is what
      // the question is almost always about. A województwo has two, a powiat
      // lists its gminy's beside the starostwo, and nothing is assumed.
      picked.value =
        offices.value.length === 1
          ? offices.value[0]!.regon
          : offices.value.length === 0
            ? OTHER
            : undefined;
    }
  }
}

watch(() => props.regionId, load, { immediate: true });

/** Where a powiat's list of its gminy's urzędy starts, after its own. */
const firstGmina = computed(() => offices.value.find((o) => o.gmina));

function onCreated(created: Link<NodeType>) {
  createdIds.value = new Set([...createdIds.value, created.id]);
}

const workplace = computed<RegionWorkplace | undefined>(() => {
  if (picked.value === OTHER) {
    return place.value
      ? { place: place.value, created: createdIds.value.has(place.value.id) }
      : undefined;
  }
  const office = offices.value.find((o) => o.regon === picked.value);
  return office ? { office } : undefined;
});

watch(
  workplace,
  (value) => {
    model.value = value;
  },
  { immediate: true },
);
</script>

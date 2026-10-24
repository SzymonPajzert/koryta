<template>
  <div v-if="companies.length > 0" class="mb-4 mt-2">
    <div v-if="!collapsible" class="d-flex flex-column ga-4">
      <CardCompanySummary
        v-for="companyData in companies"
        :key="companyData.id"
        :company="companyData"
        :location="companyData.location"
        link-to-page
      />
    </div>

    <v-card v-else variant="outlined">
      <v-card-text class="d-flex flex-wrap align-center ga-4">
        <div class="d-flex align-center ga-2 mr-auto">
          <v-icon :icon="mdiOfficeBuildingOutline" class="flex-shrink-0" />
          <span class="text-h6">Wybrane firmy ({{ companies.length }})</span>
        </div>
        <v-btn
          variant="tonal"
          :append-icon="expanded ? mdiChevronUp : mdiChevronDown"
          @click="expanded = !expanded"
        >
          {{ expanded ? "Zwiń" : "Pokaż szczegóły" }}
        </v-btn>
      </v-card-text>

      <!-- Collapsed, the names are the whole point: they are what tells you
           which filter you are looking at. Expanded, each summary repeats its
           own name, so the chips would only be noise. -->
      <v-card-text v-if="!expanded" class="pt-0 d-flex flex-wrap ga-2">
        <v-chip
          v-for="companyData in companies"
          :key="companyData.id"
          size="small"
          label
          :to="companyUrl(companyData)"
        >
          {{ companyData.name }}
        </v-chip>
      </v-card-text>

      <v-expand-transition>
        <!-- v-if rather than v-show: each summary carries a note editor and a
             revision dialog, and seventeen of those are what made this page
             heavy in the first place. -->
        <div v-if="expanded">
          <v-card-text class="pt-0 d-flex flex-column ga-4">
            <CardCompanySummary
              v-for="companyData in companies"
              :key="companyData.id"
              :company="companyData"
              :location="companyData.location"
              link-to-page
            />
          </v-card-text>
        </div>
      </v-expand-transition>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { generateEntityUrl } from "~~/shared/slugs";
import type { Company } from "~~/shared/model";

const props = withDefaults(
  defineProps<{
    companies: (Company & { id: string; location: string | undefined })[];
    /** Number of companies from which the summaries fold away. */
    collapseFrom?: number;
  }>(),
  { collapseFrom: 3 },
);

// A handful of summaries is a useful header; seventeen of them push the table
// itself off the screen, so past that they fold into a list of names.
const collapsible = computed(
  () => props.companies.length >= props.collapseFrom,
);

const expanded = ref(false);

// Collapsed, the chips are the only handle on a company there is - the
// summaries, and the link on each of their names, are folded away.
function companyUrl(company: Company & { id: string }) {
  return generateEntityUrl("place", company.id, company.name);
}
</script>

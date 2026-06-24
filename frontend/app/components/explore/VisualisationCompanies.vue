<template>
  <div>
    <div v-if="companies.length === 0" class="text-center pa-8 text-grey">
      Brak danych do wyświetlenia. Spróbuj zmienić filtry.
    </div>
    <v-card
      v-for="company in companies"
      :key="company.name"
      class="mb-4 pa-4"
      variant="outlined"
    >
      <div class="d-flex flex-column flex-md-row align-md-center">
        <div
          class="flex-grow-1 font-weight-bold mb-2 mb-md-0"
          style="min-width: 250px; max-width: 400px; word-wrap: break-word"
        >
          {{ company.name }}
        </div>

        <div class="d-flex align-center flex-grow-1" style="min-width: 200px">
          <!-- Bar chart wrapper -->
          <div class="bar-chart-container w-100 mr-4">
            <div
              v-for="party in company.partySegments"
              :key="party.name"
              class="bar-segment"
              :style="{
                width: party.percentage + '%',
                backgroundColor: party.color,
              }"
              :title="`${party.name}: ${party.count}`"
            />
            <div
              v-if="company.unaffiliatedPercentage > 0"
              class="bar-segment"
              :style="{
                width: company.unaffiliatedPercentage + '%',
                backgroundColor: '#e0e0e0',
              }"
              title="Brak partii / Nieznana"
            />
          </div>

          <div
            class="text-body-2 text-no-wrap"
            style="min-width: 120px; text-align: right"
          >
            {{ company.affiliatedPercentage.toFixed(0) }}% upolityczniona
            <br />
            <NuxtLink
              v-if="company.krsNumber"
              :to="`/eksploruj/tabela?krs=${company.krsNumber}`"
              class="text-grey text-caption text-decoration-none"
            >
              ({{ company.affiliatedPeople }} z {{ company.totalPeople }} osób)
            </NuxtLink>
            <span v-else class="text-grey text-caption">
              ({{ company.affiliatedPeople }} z {{ company.totalPeople }} osób)
            </span>
          </div>
        </div>
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PersonRich } from "~~/shared/model";
import { partyColors } from "~~/shared/misc";

const { entities: places } = useEntities("place");

const props = defineProps<{
  people: PersonRich[];
  allowedCompanies?: string[] | null;
}>();

interface CompanyData {
  name: string;
  totalPeople: number;
  affiliatedPeople: number;
  partyCounts: Record<string, number>;
  krsNumber?: string;
}

const companies = computed(() => {
  const stats = new Map<string, CompanyData>();

  for (const person of props.people) {
    if (person.companies.length === 0) continue;

    const hasAffiliation =
      (Array.isArray(person.parties)
        ? person.parties.length > 0
        : Object.keys(
            (person.parties as unknown as
              | Record<string, unknown>
              | undefined) || {},
          ).length > 0) || person.elections.length > 0;

    for (const companyName of person.companies) {
      if (!companyName) continue;
      if (
        props.allowedCompanies &&
        props.allowedCompanies.length > 0 &&
        !props.allowedCompanies.includes(companyName)
      ) {
        continue;
      }
      if (!stats.has(companyName)) {
        let krsNumber: string | undefined = undefined;
        if (places.value) {
          for (const place of Object.values(places.value)) {
            if (place.name === companyName && place.krsNumber) {
              krsNumber = place.krsNumber;
              break;
            }
          }
        }

        stats.set(companyName, {
          name: companyName,
          totalPeople: 0,
          affiliatedPeople: 0,
          partyCounts: {},
          krsNumber,
        });
      }

      const company = stats.get(companyName)!;
      company.totalPeople++;

      if (hasAffiliation) {
        company.affiliatedPeople++;
        let partiesToCount = Array.isArray(person.parties)
          ? [...person.parties]
          : Object.keys(
              (person.parties as unknown as
                | Record<string, unknown>
                | undefined) || {},
            );

        if (partiesToCount.length === 0) {
          partiesToCount = ["Brak partii"];
        }

        for (const party of partiesToCount) {
          company.partyCounts[party] = (company.partyCounts[party] || 0) + 1;
        }
      }
    }
  }

  const result = Array.from(stats.values()).map((company) => {
    // Total affiliations could be slightly higher than affiliatedPeople if a person belongs to multiple parties
    // But for the visualization, we distribute the percentages based on totalPeople.

    // We calculate how many spots are taken by parties
    let totalPartyMentions = 0;
    for (const count of Object.values(company.partyCounts)) {
      totalPartyMentions += count;
    }

    // This logic ensures that if someone has 2 parties, we still just show their segments.
    // However, the sum of percentages could theoretically exceed 100% if we just divide by totalPeople.
    // So we normalize the party segments against affiliatedPeople if totalPartyMentions > affiliatedPeople.
    const normalizationFactor =
      totalPartyMentions > company.affiliatedPeople
        ? company.affiliatedPeople / totalPartyMentions
        : 1;

    const partySegments = Object.entries(company.partyCounts)
      .map(([name, count]) => {
        const normalizedCount = count * normalizationFactor;
        return {
          name,
          count,
          percentage: (normalizedCount / company.totalPeople) * 100,
          color: partyColors[name] || "#999999",
        };
      })
      .sort((a, b) => b.percentage - a.percentage);

    const affiliatedPercentage =
      (company.affiliatedPeople / company.totalPeople) * 100;
    const unaffiliatedPercentage =
      100 - partySegments.reduce((sum, p) => sum + p.percentage, 0);

    return {
      ...company,
      partySegments,
      affiliatedPercentage,
      unaffiliatedPercentage: Math.max(0, unaffiliatedPercentage),
    };
  });

  // Sort by most politicized first:
  // 1. Absolute number of affiliated people (desc)
  // 2. Percentage of affiliated people (desc)
  // 3. Total people (desc)
  return result.sort((a, b) => {
    if (b.affiliatedPeople !== a.affiliatedPeople) {
      return b.affiliatedPeople - a.affiliatedPeople;
    }
    if (b.affiliatedPercentage !== a.affiliatedPercentage) {
      return b.affiliatedPercentage - a.affiliatedPercentage;
    }
    return b.totalPeople - a.totalPeople;
  });
});
</script>

<style scoped>
.bar-chart-container {
  height: 24px;
  background-color: #f5f5f5;
  border-radius: 4px;
  display: flex;
  overflow: hidden;
}

.bar-segment {
  height: 100%;
  transition: width 0.3s ease;
}
</style>

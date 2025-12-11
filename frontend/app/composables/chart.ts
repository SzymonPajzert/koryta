import { usePartyStatistics } from "@/composables/party";
import { computed } from "vue";
import {
  parties as partiesUnfiltered,
  partyColors as partyColorsUnfiltered,
} from "~~/shared/misc";

export async function usePartyChartData() {
    const { results: resultsUnfiltered } = await usePartyStatistics();

    const nonZeroIndices = computed(() =>
        resultsUnfiltered.value.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0),
    );

    const parties = computed(
        () =>
        partiesUnfiltered.filter((_, i) => nonZeroIndices.value.includes(i)) ?? [],
    );

    const partyColors = computed(() =>
        Object.values(partyColorsUnfiltered).filter((_, i) =>
        nonZeroIndices.value.includes(i),
        ),
    );

    const results = computed(() =>
        resultsUnfiltered.value.filter((_, i) => nonZeroIndices.value.includes(i)),
    );

    const series = computed(() => {
        if (!parties.value || !results.value) return [];
        if (parties.value.length !== results.value.length) return [];
    
        return [
        {
            data: parties.value.map((party, index) => ({
            x: party,
            y: results.value[index],
            })),
        },
        ];
    });

    return {
        parties,
        partyColors,
        results,
        series
    };
}

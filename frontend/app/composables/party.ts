import { computed } from "vue";
import { partyColors } from "~~/shared/misc";

export const usePartyStatistics = async () => {
  const partyStats: Record<string, number> = {
    PO: 360,
    PiS: 395,
    PSL: 62,
    "Polska 2050": 19,
    "Nowa Lewica": 9,
    Konfederacja: 2,
  };

  const results = computed<number[]>(() => {
    return (Object.keys(partyColors) as (keyof typeof partyColors)[]).map(
      (party) => {
        return partyStats[party] ?? 0;
      },
    );
  });

  return { results };
};

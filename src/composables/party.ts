import { ref, computed } from "vue";
import { useListEntity } from "./entity";

export function usePartyStatistics() {
  const { entities: people } = useListEntity("employed");

  const parties = ref<string[]>([
    "PO",
    "PiS",
    "PSL",
    "Polska 2050",
    "Nowa Lewica",
    "Konfederacja",
    "Razem",
  ]);

  const partyColors = ref<Record<string, string>>({
    // TODO if the color is dark enough, switch text color in the chip to white
    PO: "#fca241",
    PiS: "#073b76",
    PSL: "#2ed396",
    "Polska 2050": "#FFCB03",
    "Nowa Lewica": "#D40E20",
    Konfederacja: "#102440",
    Razem: "#871057",
  });
  const results = computed<number[]>(() => {
    return Object.keys(partyColors.value).map((party) => {
      return Object.values(people.value).filter((person) => {
        return (person.parties ?? []).findIndex((p) => p === party) != -1;
      }).length;
    });
  });

  return { parties, partyColors, results };
}

import { ref, computed } from "vue";
import { useRTDB } from "@vueuse/firebase/useRTDB";
import { db } from "@/firebase";
import { ref as dbRef } from "firebase/database";
import { type NepoEmployment } from "./model";

export function useListEmployment() {
  const peopleRaw = useRTDB<{ employed: Record<string, NepoEmployment> }>(
    dbRef(db, "employed")
  );
  const people = computed<Record<string, NepoEmployment>>(() =>
    peopleRaw.value ?? {}
  );
  return { people };
}

export function usePartyStatistics() {
  const { people } = useListEmployment();

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
    "PO": "#fca241",
    "PiS": "#A9D1DF", // TODO jasny placeholder dla '#073b76'
    "PSL": "#2ed396",
    "Polska 2050": "#FFCB03",
    "Nowa Lewica": "#D40E20",
    "Konfederacja": "#A9D1DF", // TODO jasny placeholder dla '#102440'
    "Razem": "#871057",
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

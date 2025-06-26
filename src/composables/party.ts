import { ref, computed } from "vue";
import { useRTDB } from "@vueuse/firebase/useRTDB";
import { db } from "@/firebase";
import { ref as dbRef } from "firebase/database";
import { type Textable, type Connection } from "./entity";

export interface NepoEmployment {
  name: string;
  parties?: string[];
  employments?: Record<string, Connection>;
  connections?: Record<string, Connection>;
  sources: Record<string, Textable>;
  sourceURL: string; // TODO get rid of it
  comments?: Record<string, Textable>;
  descriptionLen?: number;
}

export function useListEmployment() {
  const peopleRaw = useRTDB<{ employed: Record<string, NepoEmployment> }>(
    dbRef(db, "employed")
  );
  const people = computed<Record<string, NepoEmployment>>(() =>
    Object.fromEntries(
      Object.entries(peopleRaw.value ?? {}).map(([key, value]) => [
        key,
        {
          ...value,
          descriptionLen:
            Object.values(value.employments ?? {})
              .map((e) => e.text.length)
              .reduce((a, b) => a + b, 0) +
            Object.values(value.connections ?? {})
              .map((e) => e.text.length)
              .reduce((a, b) => a + b, 0),
        } as NepoEmployment,
      ])
    )
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

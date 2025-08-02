import { type Ref } from "vue";
import { createEntityStore } from "@/stores/entity";

interface CompanyScore {
  name: string;
  good: number;
  bad: number;
  score: Score;
}

export type Score = number | "start";

export function toNumber(a: Score): number {
  if (a === "start") return 0;
  return a;
}

export function useCompanyScore(
  firstChance: Ref<number>,
  ignoreSuccess: Ref<number>,
) {
  const useCompanyStore = createEntityStore("external/rejestr-io/krs");
  const companyStore = useCompanyStore();
  const { entities: companies } = storeToRefs(companyStore);

  const usePeopleStore = createEntityStore("external/rejestr-io/person");
  const peopleStore = usePeopleStore();
  const { entities: people } = storeToRefs(peopleStore);

  const scores = computed(() => {
    const result: Record<string, CompanyScore> = {};

    Object.entries(companies.value).forEach(([key, company]) => {
      Object.keys(company.connections ?? {}).forEach((personKey) => {
        if (!people.value && !(personKey in people.value)) return;
        const person = people.value[personKey];
        if (!person) return;
        console.log(personKey)
        if (!(key in result)) {
          result[key] = {
            name: (company.basic ?? company.external_basic)?.nazwy.skrocona ?? "",
            good: 0,
            bad: 0,
            score: 0,
          };
        }
        if (person.score) {
          if (person.score > 0) {
            result[key].good += person.score;
          } else {
            result[key].bad += -person.score;
          }
        }
      });
    });

    Object.keys(result).forEach((key) => {
      const v = result[key];
      if (v.good == 0 && v.good + v.bad < firstChance.value) {
        result[key].score = "start";
      } else if (v.good == 0) {
        result[key].score = -v.bad;
      } else if (v.bad > v.good * ignoreSuccess.value) {
        result[key].score = -v.bad / v.good;
      } else {
        result[key].score = result[key].good / Math.max(result[key].bad, 0.01);
      }
    });

    return result;
  });

  return { scores };
}

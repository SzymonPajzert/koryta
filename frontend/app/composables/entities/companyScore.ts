interface CompanyScore {
  name: string;
  good: number;
  bad: number;
  score: Score;
}

export interface CompanyMembership {
  name: string;
  id: string;
  state: "aktualne" | "historyczne";
  score: CompanyScore;
}

export type Score = number | "start";

export function toNumber(a: Score): number {
  if (a === "start") return 0;
  return a;
}

const firstChance = 2 as const;
const ignoreSuccess = 3 as const;

export function useCompanyScore() {
  // TODO fetch person, record, company scores
  // TODO Use edges to merge them together
  const _discard = firstChance + ignoreSuccess

  const scores = computed<Record<string, CompanyScore>>(() => ({}));
  const personCompanies = computed<Record<string, CompanyMembership[]>>(() => ({}))
  const personScore = computed(() => {});

  return { scores, personCompanies, personScore };
}

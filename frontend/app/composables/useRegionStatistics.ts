import { ref } from "vue";

export type Company = {
  nodeId: string;
  name: string;
};

export type Person = {
  name: string;
  party?: string;
  accountId?: string;
  currentEmployment?: Company;
  pastEmployment?: Company;
};

export type UkorycenieData = {
  regionName: string;
  people: Person[];
};

export function useRegionStatistics(terytCode: string) {
  const data = ref<UkorycenieData | undefined>(undefined);
  const loading = ref(true);
  const error = ref<Error | undefined>(undefined);

  // Mock data fetching for 2 teryt codes
  setTimeout(() => {
    if (terytCode === "1261") {
      data.value = {
        regionName: "Województwo Dolnośląskie",
        people: [
          {
            name: "Jan Kowalski",
            party: "PO",
            accountId: "node-1",
            currentEmployment: { nodeId: "comp-1", name: "Wodociągi Miejskie" },
          },
          {
            name: "Anna Nowak",
            party: "PiS",
            accountId: "node-2",
            pastEmployment: { nodeId: "comp-2", name: "Zarząd Zieleni" },
          },
          { name: "Piotr Wiśniewski", party: "PSL", accountId: "node-3" },
          {
            name: "Zofia Wójcik",
            party: "Polska 2050",
            currentEmployment: { nodeId: "comp-3", name: "Spółka Komunalna" },
          },
          { name: "Michał Kamiński", accountId: "node-4" },
        ],
      };
    }
    loading.value = false;
  }, 500);

  return { data, loading, error };
}

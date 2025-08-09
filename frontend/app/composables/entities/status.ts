import { createEntityStore } from "@/stores/entity";
import {
  type Connection,
  type Destination,
  type Nameable,
} from "@/../shared/model";
import { type Ref } from "vue";
import { type GraphLayout } from "~/../shared/graph/util";

type ListItem = [string, Nameable & Status];

interface Issue {
  name: string;
  priority: number;
}

export interface Status {
  issues: Issue[];
  priority: number;
  hasPlace: boolean;
  destination: Destination;
  subtitle: string;
}

export function useEntityStatus(allowedIssues?: Ref<string[]>) {
  const { allowEntity } = useParams("Status");
  const useListData = createEntityStore("data");
  const dataStore = useListData();
  const { entities: articlesRaw } = storeToRefs(dataStore);

  const useListEmployed = createEntityStore("employed");
  const employedStore = useListEmployed();
  const { entities: peopleRaw } = storeToRefs(employedStore);

  const useListCompany = createEntityStore("company");
  const companyStore = useListCompany();
  const { entities: placesRaw } = storeToRefs(companyStore);

  // We will set priority later, so it's ommited from the type
  function emptyIssue(
    key: string,
    value: Nameable,
    destination: Destination,
  ): [string, Nameable & Omit<Status, "priority" | "subtitle">] {
    return [
      key,
      {
        ...value,
        issues: [] as Issue[],
        destination: destination,
        hasPlace: true,
      },
    ];
  }

  function testConnection(
    issues: Issue[],
    name: string,
  ): (connection: Connection<any>) => void {
    return (connection) => {
      if (!connection.text) {
        issues.push({ name: `Brak tekstu o relacji ${name}`, priority: 1 });
      }
      if (!connection.relation) {
        issues.push({ name: `Brak nazwy relacji ${name}`, priority: 3 });
      }
      if (connection.connection && !connection.connection?.id) {
        issues.push({ name: `Relacja ${name} nie ma obiektu`, priority: 100 });
      }
    };
  }

  const articles = computed(() => {
    return Object.entries(articlesRaw.value).map(([key, article]) => {
      const results = emptyIssue(key, article, "data");
      // TODO check for duplicates
      if (!article.sourceURL) {
        results[1].issues.push({ name: "Brak źródła", priority: 100 });
      }
      if (!article.name) {
        results[1].issues.push({ name: "Brak nazwy", priority: 100 });
      }
      if (!article.shortName) {
        results[1].issues.push({ name: "Brak skróconej nazwy", priority: 10 });
      }
      if (!article.people) {
        results[1].issues.push({
          name: "Brak wspomnianych ludzi",
          priority: 2,
        });
      }
      const peopleLeft =
        (article.estimates?.mentionedPeople ?? 0) -
        Object.keys(article.people ?? {}).length;
      if (peopleLeft > 0) {
        results[1].issues.push({
          name: "Brak wspomnianych ludzi",
          priority: peopleLeft,
        });
      }
      if (!article.companies) {
        results[1].hasPlace = false;
        results[1].issues.push({ name: "Brak wspomnianych firm", priority: 1 });
      }

      return results;
    });
  });

  const people = computed(() => {
    return Object.entries(peopleRaw.value).map(([key, person]) => {
      const results = emptyIssue(key, person, "employed");

      if (!person.connections) {
        results[1].issues.push({ name: "Brak połączonych ludzi", priority: 5 });
      }
      Object.values(person.connections ?? {}).forEach(
        testConnection(results[1].issues, "znajomy/a"),
      );
      if (!person.employments) {
        results[1].issues.push({ name: "Brak miejsc pracy", priority: 5 });
      }
      Object.values(person.employments ?? {}).forEach(
        testConnection(results[1].issues, "zatrudnienie"),
      );
      Object.values(person.comments ?? {}).forEach((comment) => {
        results[1].issues.push({
          name: "Nierozwiązany komentarz",
          priority: 5,
        });
      });

      return results;
    });
  });

  const places = computed(() => {
    return Object.entries(placesRaw.value).map(([key, place]) => {
      const results = emptyIssue(key, place, "company");

      if (place.owner) {
        results[1].issues.push({
          name: "Przestarzały format",
          priority: 5,
        });
      }
      if (place.manager) {
        results[1].issues.push({
          name: "Przestarzały format",
          priority: 5,
        });
      }

      return results;
    });
  });

  // Gather all of them together and list their state.
  const statusList = computed<ListItem[]>(() => {
    return [...articles.value, ...people.value, ...places.value]
      .map(([key, value]) => {
        const entity = {
          ...value,
          priority: value.issues
            .filter(
              (i) =>
                !allowedIssues?.value ||
                allowedIssues.value.length == 0 ||
                allowedIssues.value.includes(i.name),
            )
            .reduce((a, b) => a + b.priority, 0),
          subtitle: "",
        };
        if (entity.issues.length > 0) {
          entity.subtitle = `${entity.issues.length} problemów o łącznym priorytecie ${entity.priority}`;
        }
        entity.issues.sort((a, b) => b.priority - a.priority);

        const result: ListItem = [key, entity];
        return result;
      })
      .filter(([key, entity]) => {
        const matchesFilter = allowEntity(key);
        const nonEmptyIssues = !!entity.issues;
        return (!entity.hasPlace || matchesFilter) && nonEmptyIssues;
      })
      .sort((a, b) => b[1].priority - a[1].priority);
  });

  const issueNames = computed<string[]>(() => {
    const byPriority = new Map<string, number>();
    statusList.value.forEach((li) =>
      li[1].issues.forEach((i) => {
        byPriority.set(
          i.name,
          Math.max(byPriority.get(i.name) ?? 0, i.priority),
        );
      }),
    );
    return [...byPriority.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((i) => i[0]);
  });

  return { statusList, issueNames };
}

<template>
  <v-list>
    <v-list-group v-for="[key, entity] in entities">
      <template v-slot:activator="{ props }">
        <v-list-item
          v-bind="props"
          :title="entity.name"
          :subtitle="entity.subtitle"
          :variant="!entity.hasPlace && nodeGroupPicked ? 'tonal' : undefined"
        >
          <template v-slot:prepend>
            <v-icon :icon="destinationIcon[entity.destination]" />
          </template>
          <template v-slot:append>
            <v-btn
              color="grey-lighten-1"
              @click.stop="
                dialogStore.open({
                  type: entity.destination,
                  edit: { value: entity, key: key },
                })
              "
              icon="mdi-pencil-outline"
              variant="text"
            ></v-btn>
            <v-icon icon="mdi-chevron-down" v-if="entity.issues.length > 0" />
          </template>
        </v-list-item>
      </template>

      <v-list-item
        v-for="issue in entity.issues"
        :title="`${issue.name} - [${issue.priority}]`"
      />
    </v-list-group>
  </v-list>
</template>

<script setup lang="ts">
import { useListEntity } from "@/composables/entity";
import { destinationIcon, type Connection, type Destination, type Nameable } from "@/composables/model";
import { useGraphStore } from "@/stores/graph";
import { useDialogStore } from "@/stores/dialog";

const { entities: articlesRaw } = useListEntity("data");
const { entities: peopleRaw } = useListEntity("employed");
const { entities: placesRaw } = useListEntity("company");

const graphStore = useGraphStore();
const dialogStore = useDialogStore();

const { nodeGroupPicked } = storeToRefs(graphStore);

interface Status {
  issues: Issue[];
  priority: number;
  hasPlace: boolean;
  destination: Destination;
  subtitle: string;
}

type ListItem = [string, Nameable & Status];

interface Issue {
  name: string;
  priority: number;
}

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
): (connection: Connection) => void {
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
      results[1].issues.push({ name: "Brak wspomnianych ludzi", priority: 2 });
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

    if (person.sourceURL) {
      results[1].issues.push({
        name: "Przestarzały format źródła",
        priority: 10,
      });
    }
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
      results[1].issues.push({ name: "Nierozwiązany komentarz", priority: 5 });
    });

    return results;
  });
});

// Gather all of them together and list their state.
const entities = computed<ListItem[]>(() => {
  return [...articles.value, ...people.value]
    .map(([key, value]) => {
      const entity = {
        ...value,
        priority: value.issues.reduce((a, b) => a + b.priority, 0),
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
      const matchesFilter =
        !nodeGroupPicked.value ||
        nodeGroupPicked.value?.connected.includes(key);
      return !entity.hasPlace || matchesFilter;
    })
    .sort((a, b) => b[1].priority - a[1].priority);
});
</script>

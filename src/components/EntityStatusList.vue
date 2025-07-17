<template>
  <v-list>
    <v-list-group v-for="[key, entity] in statusList">
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
import { useEntityStatus } from "@/composables/entities/status";
import { destinationIcon } from "@/composables/model";
import { useDialogStore } from "@/stores/dialog";
import { useGraphStore } from "@/stores/graph";
const graphStore = useGraphStore();

const props = defineProps<{
  allowedIssues: string[];
}>();

const dialogStore = useDialogStore();
const { nodeGroupPicked } = storeToRefs(graphStore);
const { statusList } = useEntityStatus(toRef(props, "allowedIssues"));
</script>

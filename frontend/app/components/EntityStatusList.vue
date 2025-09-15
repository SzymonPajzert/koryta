<template>
  <v-list>
    <v-list-group v-for="[key, entity] in statusList" :key="key">
      <template #activator="{ props: activatorProps }">
        <v-list-item
          v-bind="activatorProps"
          :title="entity.name"
          :subtitle="entity.subtitle"
          :variant="!entity.hasPlace && placeFilterID ? 'tonal' : undefined"
        >
          <template #prepend>
            <v-icon :icon="destinationIcon[entity.destination]" />
          </template>
          <template #append>
            <v-btn
              color="grey-lighten-1"
              icon="mdi-pencil-outline"
              variant="text"
              @click.stop="
                dialogStore.open({
                  type: entity.destination,
                  edit: { value: entity, key: key },
                } as NewEntityPayload<typeof entity.destination>)
              "
            />
            <v-icon v-if="entity.issues.length > 0" icon="mdi-chevron-down" />
          </template>
        </v-list-item>
      </template>

      <v-list-item
        v-for="issue in entity.issues"
        :key="issue.name"
        :title="`${issue.name} - [${issue.priority}]`"
      />
    </v-list-group>
  </v-list>
</template>

<script setup lang="ts">
import { useEntityStatus } from "@/composables/entities/status";
import { destinationIcon } from "@/../shared/model";
import { useDialogStore, type NewEntityPayload } from "@/stores/dialog";

const props = defineProps<{
  allowedIssues: string[];
  placeFilterID?: string;
}>();

const dialogStore = useDialogStore();
const { statusList } = useEntityStatus(toRef(props, "allowedIssues"));
</script>

<template>
  <div>
    <div class="d-flex flex-wrap justify-center align-center ga-4 mb-4">
      <DialogProposeEditNode
        :entity="person"
        skip-redirect
        @submitted="onRevisionSubmitted"
      >
        <template #activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="tonal"
            color="warning"
            :prepend-icon="mdiPencilOutline"
          >
            Zaproponuj zmianę
          </v-btn>
        </template>
      </DialogProposeEditNode>

      <slot />
    </div>

    <v-alert
      v-if="submittedRevisionId"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Zaproponowano zmianę.
      <a
        :href="previewUrl"
        target="_blank"
        class="text-primary font-weight-bold"
      >
        Podgląd zmiany
        <v-icon :icon="mdiOpenInNew" size="small" />
      </a>
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { mdiOpenInNew, mdiPencilOutline } from "@mdi/js";
import { computed, shallowRef } from "vue";
import type { PersonRich } from "~~/shared/model";
import { generateEntityUrl } from "~/composables/slugs";

const props = defineProps<{ person: PersonRich }>();

// Callers key this component by person id, so the notice resets on its own
// when the focused person changes.
const submittedRevisionId = shallowRef<string | undefined>(undefined);

const onRevisionSubmitted = (revisionId: string) => {
  submittedRevisionId.value = revisionId;
};

const previewUrl = computed(() => {
  const baseUrl = generateEntityUrl(
    "person",
    props.person.id,
    props.person.name,
  );
  return `${baseUrl}?revisionId=${submittedRevisionId.value}`;
});
</script>

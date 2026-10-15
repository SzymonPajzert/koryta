<template>
  <!-- The control tint, not an outline, with the pencil in amber: the one
       treatment of „Zaproponuj zmianę” on every entity page. Szymon,
       2026-10-16: „Zaproponuj zmianę should be amber and uniform”. The
       amber-outlined square it replaces outweighed the name beside it. -->
  <v-btn variant="tonal">
    <template #prepend>
      <v-icon :icon="mdiPencilOutline" color="warning" />
    </template>
    Zaproponuj zmianę
  </v-btn>
</template>

<script setup lang="ts">
import { mdiPencilOutline } from "@mdi/js";

/** „Zaproponuj zmianę” at the head of an entity's page, as the activator of
 * `DialogProposeEditNode`: bind the slot's props to it,
 * `<ButtonProposeChange v-bind="activatorProps" />`. Attributes - a class, a
 * data-testid, the click - fall through to the button. */
</script>

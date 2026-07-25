<template>
  <v-alert type="info" variant="tonal" class="mb-4" :icon="mdiAccountLock">
    <div class="d-flex flex-wrap align-center justify-space-between ga-3 w-100">
      <div>
        Zaloguj się, aby uzyskać dostęp do jeszcze nieopublikowanych /
        niezweryfikowanych osób.
        <template v-if="hiddenCount > 0">
          W tym widoku znaleźliśmy jeszcze
          <strong>{{
            polishCounting(
              hiddenCount,
              "dodatkowa osoba",
              "dodatkowe osoby",
              "dodatkowych osób",
            )
          }}</strong
          >.
        </template>
      </div>
      <v-btn color="primary" variant="flat" to="/login" class="flex-shrink-0">
        Zaloguj się
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { mdiAccountLock } from "@mdi/js";
defineProps<{
  hiddenCount: number;
}>();
</script>

<template>
  <v-alert type="info" variant="tonal" class="mb-4" icon="mdi-account-lock">
    <div class="d-flex align-center justify-space-between w-100">
      <div>
        Zaloguj się, aby uzyskać dostęp do jeszcze nieopublikowanych /
        niezweryfikowanych osób.
        <template v-if="hiddenCount > 0">
          W tym widoku znaleźliśmy jeszcze
          <strong>{{ hiddenCount }} dodatkowych osób</strong>.
        </template>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        to="/login"
        class="ml-4 flex-shrink-0"
      >
        Zaloguj się
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
defineProps<{
  hiddenCount: number;
}>();
</script>

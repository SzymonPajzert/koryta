<template>
  <v-col cols="12">
    <v-card
      class="py-4"
      color="surface-variant"
      :to="props.router ? props.router : undefined"
      :prepend-icon="props.icon"
      rel="noopener noreferrer"
      rounded="lg"
      variant="tonal"
    >
      <template #title>
        <h2 class="text-h5 font-weight-bold">
          <slot name="header"></slot>
        </h2>
      </template>

      <template #subtitle>
        <div class="text-subtitle-1">
          <slot></slot>
        </div>
      </template>
    </v-card>
  </v-col>
</template>

<script lang="ts" setup>
const props = defineProps<{ router?: string; icon: string }>();
</script>

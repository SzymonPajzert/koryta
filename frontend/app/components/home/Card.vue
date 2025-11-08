<template>
  <v-card color="surface-variant" rounded="lg" variant="tonal">
    <template v-if="!!$slots.header" #title>
      <h2 class="text-h5 font-weight-bold">
        <slot name="header" />
      </h2>
    </template>

    <template #text>
      <slot />
    </template>
  </v-card>
</template>

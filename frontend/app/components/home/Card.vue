<template>
  <v-card color="surface-variant" variant="tonal">
    <template v-if="!!$slots.header" #title>
      <h2 class="text-h5">
        <slot name="header" />
      </h2>
    </template>

    <template #text>
      <slot />
    </template>
  </v-card>
</template>

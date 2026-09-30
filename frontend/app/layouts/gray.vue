<template>
  <NuxtLayout name="default">
    <!-- Pages using this layout must also set fullWidth: true in their page
         meta, otherwise the default layout constrains and pads the grey band. -->
    <div class="w-100 bg-backdrop">
      <v-container fluid class="pa-4 py-md-10">
        <!-- A page's `maxWidth` caps the sheet, as the default layout caps the
             page with it: how wide the content may be. The default layout
             ignores it under `fullWidth`, so nothing reads it twice. A text
             read line by line asks for less than 1200: /plik's documents. -->
        <v-sheet
          class="mx-auto pa-6 pa-md-10"
          :max-width="route.meta.maxWidth ?? 1200"
          rounded="lg"
          border
        >
          <slot />
        </v-sheet>
      </v-container>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
const route = useRoute();
</script>

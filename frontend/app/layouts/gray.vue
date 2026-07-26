<template>
  <NuxtLayout name="default">
    <!-- Pages using this layout must also set fullWidth: true in their page
         meta, otherwise the default layout constrains and pads the grey band. -->
    <div class="w-100 bg-grey-lighten-4">
      <v-container fluid class="pa-4 py-md-10">
        <v-sheet
          class="mx-auto pa-6 pa-md-10"
          max-width="1200"
          rounded="lg"
          border
        >
          <slot />
        </v-sheet>
      </v-container>
    </div>
  </NuxtLayout>
</template>

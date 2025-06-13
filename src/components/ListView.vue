<template>
  <div>
    TODO
    <v-row>
      <v-col v-for="link in links" :key="link.href" cols="12">
        <v-card
          class="py-4"
          color="surface-variant"
          image="https://cdn.vuetifyjs.com/docs/images/one/create/feature.png"
          prepend-icon="mdi-rocket-launch-outline"
          rounded="lg"
          variant="tonal"
        >
          <template #image>
            <v-img position="top right" />
          </template>

          <template #title>
            <h2 class="text-h5 font-weight-bold">
              Get started
            </h2>
          </template>

          <template #subtitle>
            <div class="text-subtitle-1">
              Change this page by updating <v-kbd>{{ `<HelloWorld />` }}</v-kbd> in <v-kbd>components/HelloWorld.vue</v-kbd>.
            </div>
          </template>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts" >
</script>

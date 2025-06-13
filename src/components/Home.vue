<template>
  <div>
    <v-img
      class="mb-4"
      height="150"
      src="@/assets/świnia.png"
    />

    <div class="mb-8 text-center">
      <h1 class="text-h2 font-weight-bold">koryta.pl</h1>
      <div class="text-body-2 font-weight-light mb-n1">Najważniejszy cel polityków</div>
    </div>

    <v-row>
      <v-col v-for="link in links" :key="link.href" cols="12">
        <v-card
          append-icon="mdi-open-in-new"
          class="py-4"
          color="surface-variant"
          :href="link.href"
          :prepend-icon="link.icon"
          rel="noopener noreferrer"
          rounded="lg"
          variant="tonal">

          <template #title>
            <h2 class="text-h5 font-weight-bold">
              {{ link.title }}
            </h2>
          </template>

          <template #subtitle>
            <div class="text-subtitle-1">
              {{ link.subtitle }}
            </div>
          </template>
        </v-card>
      </v-col>

      <v-col v-for="link in links" :key="link.href" cols="6">

      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
  const links = [
    {
      href: 'https://vuetifyjs.com/',
      icon: 'mdi-text-box-outline',
      subtitle: 'Learn about all things Vuetify in our documentation.',
      title: 'Zobacz listę',
    },
    {
      href: 'https://vuetifyjs.com/introduction/why-vuetify/#feature-guides',
      icon: 'mdi-star-circle-outline',
      subtitle: 'Explore available framework Features.',
      title: 'Dodaj osoby',
    },
    {
      href: 'https://vuetifyjs.com/introduction/why-vuetify/#feature-guides',
      icon: 'mdi-star-circle-outline',
      subtitle: 'Explore available framework Features.',
      title: 'Dołącz do projektu',
    },
  ]
</script>

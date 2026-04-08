<template>
  <div class="display-wrapper">
    <FormTypeSimulator
      ref="simulator"
      :lines="[
        {
          text: 'Rafał Trzaskowski',
          link: '/entity/person/8rg6MrDfdiRR7YaAvE5O',
        },
        { text: 'Warszawa', link: '/lista?miejsce=90LglYsGKu7JLEPGAmoD' },
        { text: 'PKP', link: '/lista?miejsce=0qGH8AL9bwUCQvrLNwiO' },
      ]"
    />
    <omni-search
      :search-text="simulator?.currentText"
      :fake="true"
      width="400px"
      class="justify-center"
    />
  </div>
</template>

<script setup lang="ts">
const simulator = ref<{ currentText: string } | null>(null);
</script>

<style scoped>
.display-wrapper {
  position: relative;
}
</style>

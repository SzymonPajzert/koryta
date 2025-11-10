<template>
  <div class="display-wrapper">
    <FormTypeSimulator
      ref="simulator"
      :lines="[
        // TODO { text: 'Andrzej Sebastian Duda', link: '/pomoc' },
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
      width="100%"
    />
  </div>
</template>

<script setup lang="ts">
const simulator = ref(null);
</script>

<style scoped>
.display-wrapper {
  position: relative;
}
</style>

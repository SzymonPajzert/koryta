<template>
  <div class="display-wrapper">
    <router-link :to="simulator?.currentLink">
      <div class="blocker-overlay" />
    </router-link>

    <FormTypeSimulator
      ref="simulator"
      :lines="[
        // TODO { text: 'Andrzej Sebastian Duda', link: '/pomoc' },
        {
          text: 'Rafał Trzaskowski',
          link: '/entity/employed/8rg6MrDfdiRR7YaAvE5O',
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

.blocker-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  /* Sit on top of everything else inside the wrapper */
  z-index: 10;
  /* Make it transparent */
  background-color: transparent;
}

.blocker-overlay:hover {
  cursor: pointer;
}
</style>

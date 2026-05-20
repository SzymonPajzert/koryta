<template>
  <div class="display-wrapper">
    <FormTypeSimulator
      ref="simulator"
      :lines="[
        {
          text: 'Rafał Trzaskowski',
          link: '/entity/person/8rg6MrDfdiRR7YaAvE5O',
        },
        { text: 'Warszawa', link: '/eksploruj/tabela?teryt=1465' },
        { text: 'PKP', link: '/eksploruj/tabela?krs=0000019193' },
      ]"
    />
    <omni-search :search-text="simulator?.currentText" :fake="true" />
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

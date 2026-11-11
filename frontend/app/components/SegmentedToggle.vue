<template>
  <!-- A toggle between two or three views of one thing, as a segmented
       control (`k-segmented`, assets/css/edges.css): the chosen option a white
       tab on the tinted track, the others at medium emphasis. `comfortable`
       makes Vuetify's group 40px high, so inside the track's 2px inset each
       tab keeps the 36px of a button. Neutral toggles only - one in a colour
       of its own (autograf's, the task dialog's third) stays a plain
       `v-btn-toggle`. -->
  <v-btn-toggle
    v-model="model"
    class="k-segmented"
    variant="text"
    density="comfortable"
    mandatory
  >
    <slot />
  </v-btn-toggle>
</template>

<script setup lang="ts" generic="T">
/** The option that is chosen: whatever the `value` of the `v-btn`s in the
 * slot is. */
const model = defineModel<T>();
</script>

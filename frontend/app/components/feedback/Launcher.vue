<template>
  <ClientOnly>
    <!-- Narrow screens get the icon with no label beside it, so the button is
         named here rather than being announced as an unlabelled control. -->
    <v-btn
      :icon="mdAndUp ? undefined : mdiMessageAlertOutline"
      :prepend-icon="mdAndUp ? mdiMessageAlertOutline : undefined"
      color="primary"
      position="fixed"
      location="bottom end"
      class="feedback-fab"
      :size="mdAndUp ? 'default' : 'small'"
      aria-label="Zgłoś błąd lub pomysł"
      @click="openDialog"
    >
      <span v-if="mdAndUp">Zgłoś</span>
    </v-btn>

    <FeedbackDialog v-model="open" />
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiMessageAlertOutline } from "@mdi/js";
import { ref } from "vue";
import { useDisplay } from "vuetify";
import { trackGoal } from "~/composables/analytics";

const { mdAndUp } = useDisplay();
const open = ref(false);

/** Counted on the button rather than on the dialog's `open` model, which the
 * close button and the auto-close after a send write to as well - one reader
 * opening the form once would otherwise be three events. */
function openDialog() {
  trackGoal("feedback:opened");
  open.value = true;
}
</script>

<style scoped>
/* Clear of the footer's bottom edge and of Vuetify's default FAB inset. */
.feedback-fab {
  margin: 0 16px 16px 0;
  z-index: 1005;
}
</style>

<template>
  <div>
    <div class="d-flex flex-wrap justify-center align-center ga-4 mb-4">
      <DialogProposeEditNode
        :entity="person"
        skip-redirect
        @submitted="onRevisionSubmitted"
      >
        <template #activator="{ props: activatorProps }">
          <!-- A tonal button writes its colour as the label, and Vuetify's
               `warning` is the #fb8c00 fill: on the wash it lays under itself
               that label measured 2.14:1. The palette's warning ink on the
               wash its own colour lays is 5.45:1, and this is the drawer's
               only way into the edit dialog. -->
          <v-btn
            v-bind="activatorProps"
            variant="tonal"
            color="ink-warning"
            :prepend-icon="mdiPencilOutline"
          >
            Zaproponuj zmianę
          </v-btn>
        </template>
      </DialogProposeEditNode>

      <slot />
    </div>

    <!-- What the button above actually edits, because „mamy teraz w sidebarze
         »zgłoś poprawkę« i »zaproponuj zmianę«, nie wiadomo co do tego służy i
         po co są dwa” - and the two are genuinely different mechanisms
         reaching different queues: this one files a revision on the record's
         own fields, the note under it is free text an admin reads. Hidden once
         a change has been submitted, so the panel says one thing at a time. -->
    <p v-if="!submittedRevisionId" class="k-lead text-center">
      Poprawia metryczkę: imię i nazwisko, partię, datę urodzenia, wykształcenie
      i linki. Propozycja czeka na zatwierdzenie. Cokolwiek innego - opisz w
      notatce niżej.
    </p>

    <!-- `color` for the same reason as the button above: `type="info"` alone
         paints Vuetify's #2196f3 at 2.74:1 on its own wash. -->
    <v-alert
      v-if="submittedRevisionId"
      type="info"
      color="ink-info"
      variant="tonal"
      class="mb-4"
    >
      Zaproponowano zmianę.
      <!-- The link a reader follows straight after submitting a change, and it
           was `text-primary` on the blue wash this alert used to lay: 1.63:1,
           the worst pair on the page. Info ink on the wash it lays now is
           5.33:1 - named on the anchor and not inherited from the alert,
           because an `<a>` with no colour of its own falls back to the
           browser's link blue. Underlined, because it now carries the same
           colour as the sentence around it, so the underline is what says it
           is a link. -->
      <a
        :href="previewUrl"
        target="_blank"
        class="text-ink-info font-weight-bold text-decoration-underline"
      >
        Podgląd zmiany
        <v-icon :icon="mdiOpenInNew" size="small" />
      </a>
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { mdiOpenInNew, mdiPencilOutline } from "@mdi/js";
import { computed, shallowRef } from "vue";
import type { PersonRich } from "~~/shared/model";
import { generateEntityUrl } from "~/composables/slugs";

const props = defineProps<{ person: PersonRich }>();

// Callers key this component by person id, so the notice resets on its own
// when the focused person changes.
const submittedRevisionId = shallowRef<string | undefined>(undefined);

const onRevisionSubmitted = (revisionId: string) => {
  submittedRevisionId.value = revisionId;
};

const previewUrl = computed(() => {
  const baseUrl = generateEntityUrl(
    "person",
    props.person.id,
    props.person.name,
  );
  return `${baseUrl}?revisionId=${submittedRevisionId.value}`;
});
</script>

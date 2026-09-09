<template>
  <!-- Nuxt renders this outside app.vue, so the Vuetify root has to be
       re-established here or every v-* component below loses its layout. -->
  <v-app>
    <NuxtLayout>
      <div class="mx-auto text-center py-12" style="max-width: 640px">
        <v-icon :icon="icon" size="96" color="primary" class="mb-6" />
        <p class="text-h2 font-weight-bold mb-2">{{ statusCode }}</p>
        <h1 class="text-h5 font-weight-bold mb-4">{{ title }}</h1>
        <p class="text-body-1 text-grey-darken-1 mb-8">{{ description }}</p>

        <div class="d-flex flex-wrap justify-center ga-3">
          <v-btn
            color="primary"
            size="large"
            :prepend-icon="mdiHome"
            @click="goHome"
          >
            Wróć na stronę główną
          </v-btn>
          <v-btn
            v-if="isNotFound"
            variant="outlined"
            size="large"
            to="/eksploruj/tabela"
          >
            Przeglądaj osoby
          </v-btn>
          <v-btn v-else variant="outlined" size="large" to="/pomoc">
            Zgłoś problem
          </v-btn>
        </div>

        <!-- Only in dev: the message can carry internals we do not want to
             hand to whoever tripped the error in production. -->
        <v-alert
          v-if="devMessage"
          type="error"
          variant="tonal"
          class="mt-10 text-left"
        >
          <pre class="text-caption text-wrap mb-0">{{ devMessage }}</pre>
        </v-alert>
      </div>
    </NuxtLayout>
  </v-app>
</template>

<script lang="ts" setup>
import { mdiAlertCircleOutline, mdiHome, mdiMapSearchOutline } from "@mdi/js";
import { computed, onMounted } from "vue";
import type { NuxtError } from "#app";
import { trackGoal } from "~/composables/analytics";

const props = defineProps<{ error: NuxtError }>();

const statusCode = computed(() => props.error.statusCode);
const isNotFound = computed(() => statusCode.value === 404);

const icon = computed(() =>
  isNotFound.value ? mdiMapSearchOutline : mdiAlertCircleOutline,
);

const title = computed(() =>
  isNotFound.value ? "Nie ma takiej strony" : "Coś poszło nie tak",
);

const description = computed(() =>
  isNotFound.value
    ? "Strona, której szukasz, została przeniesiona albo nigdy nie istniała. Sprawdź adres lub zacznij od strony głównej."
    : "Po naszej stronie wystąpił błąd. Spróbuj ponownie za chwilę - jeśli problem się powtarza, daj nam znać.",
);

const devMessage = computed(() =>
  import.meta.dev ? props.error.message : undefined,
);

useSeoMeta({
  title: title.value,
  robots: "noindex, nofollow",
});

// On mount rather than at setup, because this renders on the server too and
// the tracker is client-only. The url the reader asked for is the event's own
// url, so the goal needs no property for it - only the status, which is what
// separates a link to a page that no longer exists from something we broke.
onMounted(() => {
  trackGoal("error:shown", { status: String(statusCode.value ?? "unknown") });
});

// clearError tears down the error state before navigating; a plain
// navigateTo("/") would leave this page mounted over the homepage.
const goHome = () => clearError({ redirect: "/" });
</script>

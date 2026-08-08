<template>
  <v-container class="py-8" style="max-width: 720px">
    <v-card class="pa-6">
      <h1 class="text-h5 mb-2">Rozszerzenie do przeglądarki</h1>
      <p class="text-body-2 text-medium-emphasis mb-6">
        Zapisuje czytany artykuł w naszym archiwum i od razu wyciąga z niego
        fakty — także wtedy, gdy tekst jest za paywallem i nasz crawler widzi
        tylko zajawkę.
      </p>

      <v-alert v-if="!user" type="info" variant="tonal" class="mb-4">
        Zaloguj się, żeby połączyć rozszerzenie.
        <template #append>
          <v-btn variant="text" to="/login?redirect=/rozszerzenie">
            Zaloguj
          </v-btn>
        </template>
      </v-alert>

      <v-alert
        v-else-if="isDatascience === false"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        Twoje konto nie ma uprawnień do wysyłania artykułów. Napisz do nas,
        jeśli chcesz pomagać przy zbieraniu danych.
      </v-alert>

      <template v-else>
        <v-alert
          :type="alertType"
          variant="tonal"
          class="mb-4"
          :icon="alertType === 'success' ? mdiCheckCircle : undefined"
        >
          {{ statusMessage }}
        </v-alert>

        <v-btn
          v-if="!silent"
          color="primary"
          size="large"
          :loading="sending"
          :prepend-icon="mdiPuzzle"
          @click="sendToken"
        >
          Połącz rozszerzenie
        </v-btn>
      </template>

      <v-divider class="my-6" />

      <h2 class="text-subtitle-1 font-weight-bold mb-2">Jak to działa</h2>
      <ol class="text-body-2 ps-4">
        <li class="mb-1">
          Zainstaluj rozszerzenie i kliknij tutaj „Połącz rozszerzenie”.
        </li>
        <li class="mb-1">
          Otwórz artykuł, który chcesz dodać, i kliknij ikonę rozszerzenia.
        </li>
        <li class="mb-1">
          Jeśli strona ma nietypowy układ, zaznacz wcześniej tekst artykułu —
          zaznaczenie ma pierwszeństwo przed automatycznym wykrywaniem treści.
        </li>
        <li>
          Fakty pojawią się w
          <NuxtLink to="/ekstrakcje">kolejce do przejrzenia</NuxtLink>, a sam
          artykuł na <NuxtLink to="/zrodla">liście źródeł</NuxtLink>.
        </li>
      </ol>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
/** Where the extension gets a token from.
 *
 * The extension cannot read the Firebase session — it lives in this origin's
 * storage — so this page, which is signed in, mints a fresh id token and hands
 * it over. `?silent=1` is the extension refreshing an expired one in a
 * background tab: it does not wait for a click, and nobody is looking at the
 * page.
 */
import { computed, onMounted, ref } from "vue";
import { mdiCheckCircle, mdiPuzzle } from "@mdi/js";
import { useCurrentUser } from "vuefire";

definePageMeta({
  title: "Rozszerzenie",
  middleware: "auth",
  robots: false,
});

type ChromeRuntime = {
  runtime?: {
    sendMessage?: (
      extensionId: string,
      message: unknown,
      callback?: (response: unknown) => void,
    ) => void;
    lastError?: { message?: string };
  };
};

const route = useRoute();
const config = useRuntimeConfig();
const user = useCurrentUser();

const silent = computed(() => route.query.silent === "1");
const sending = ref(false);
const sent = ref(false);
const error = ref("");
/** Null until the claim has been read — the warning below must not flash up
 * for someone who does have the permission. */
const isDatascience = ref<boolean | null>(null);

const statusMessage = computed(() => {
  if (error.value) return error.value;
  if (sent.value) return "Połączono. Można zamknąć tę kartę.";
  if (sending.value) return "Przekazuję token do rozszerzenia…";
  return "Kliknij poniżej, żeby przekazać rozszerzeniu dostęp do Twojego konta.";
});

const alertType = computed<"success" | "error" | "info">(() => {
  if (error.value) return "error";
  return sent.value ? "success" : "info";
});

async function sendToken() {
  if (!user.value) return;
  sending.value = true;
  error.value = "";

  try {
    const result = await user.value.getIdTokenResult(true);
    isDatascience.value = result.claims.datascience === true;

    const payload = {
      type: "koryta-token",
      token: result.token,
      expiresAt: new Date(result.expirationTime).getTime(),
      email: user.value.email ?? "",
      uid: user.value.uid,
      datascience: isDatascience.value,
    };

    const extensionId = config.public.extensionId as string;
    const chromeApi = (window as unknown as { chrome?: ChromeRuntime }).chrome;

    if (extensionId && chromeApi?.runtime?.sendMessage) {
      // The published path: `externally_connectable` in the extension's
      // manifest lets this origin message it directly.
      chromeApi.runtime.sendMessage(extensionId, payload);
      sent.value = true;
    } else {
      // Development, and any build without the id compiled in. Those patterns
      // cannot name localhost, so the extension listens through a content
      // script instead and this goes into our own window for it to pick up.
      window.postMessage(payload, window.location.origin);
      sent.value = await waitForAck();
      if (!sent.value) {
        error.value =
          "Nie znaleziono rozszerzenia. Zainstaluj je i odśwież tę stronę.";
      }
    }
  } catch (err) {
    error.value = `Nie udało się przekazać tokenu: ${(err as Error).message}`;
  } finally {
    sending.value = false;
  }
}

/** The content-script relay answers with an ack; without one, nothing is
 * listening and saying "połączono" would be a lie. */
function waitForAck(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve(false);
    }, 2000);
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== "koryta-token-ack") return;
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(true);
    };
    window.addEventListener("message", listener);
  });
}

onMounted(async () => {
  const result = await user.value?.getIdTokenResult();
  isDatascience.value = result?.claims.datascience === true;
  if (silent.value && isDatascience.value) await sendToken();
});
</script>

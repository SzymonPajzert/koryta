<template>
  <div class="confirm-page mx-auto w-100 py-6">
    <v-card rounded="lg">
      <v-card-item>
        <v-card-title class="text-h5 text-wrap">
          Potwierdź zapis na newsletter
        </v-card-title>
      </v-card-item>

      <v-card-text v-if="!params" class="text-body-1" data-confirm-broken>
        Ten link jest niepełny. Otwórz go jeszcze raz z naszego maila albo
        zapisz się ponownie na <NuxtLink to="/">stronie głównej</NuxtLink>.
      </v-card-text>

      <v-card-text
        v-else-if="outcome === 'confirmed' || outcome === 'alreadyConfirmed'"
        class="text-body-1"
        data-confirm-done
      >
        <p class="confirm-page__done">
          <v-icon
            :icon="mdiCheckCircle"
            size="22"
            color="ink-sage"
            class="confirm-page__done-icon"
          />
          <span>
            {{
              outcome === "confirmed"
                ? "Gotowe. Newsletter będzie przychodził na ten adres."
                : "Ten adres jest już zapisany na newsletter."
            }}
          </span>
        </p>
        <p class="mt-3">
          Z każdego maila wypiszesz się jednym kliknięciem.
          <NuxtLink to="/">Przejdź na stronę główną</NuxtLink>.
        </p>
      </v-card-text>

      <v-card-text
        v-else-if="outcome === 'invalid'"
        class="text-body-1"
        data-confirm-invalid
      >
        Ten link wygasł albo jest nieważny. Zapisz się jeszcze raz na
        <NuxtLink to="/">stronie głównej</NuxtLink> - wyślemy nowy.
      </v-card-text>

      <template v-else>
        <v-card-text class="text-body-1">
          <p>
            Kliknij, a zaczniemy wysyłać newsletter koryta.pl na adres, na który
            przyszedł link. Piszemy raz na jakiś czas, kogo ostatnio znaleźliśmy
            na stanowiskach w publicznych spółkach i gdzie przyda się pomoc.
          </p>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            class="mt-4"
            data-confirm-error
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <!-- Wrapping: two worded buttons do not fit one row on a phone. -->
        <v-card-actions class="px-4 pb-4 pt-0 ga-2 flex-wrap">
          <v-btn
            color="ink-sage"
            variant="flat"
            :loading="saving"
            data-confirm-button
            @click="confirm"
          >
            Potwierdzam zapis
          </v-btn>
          <v-btn variant="text" to="/">Nie zapisuj mnie</v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { mdiCheckCircle } from "@mdi/js";

/** Where the confirmation mail for the newsletter without an account leads.
 * It asks before it acts, as /wypisz does: mail filters open every link in a
 * message, and a page that confirmed on load would confirm for the filter.
 * The link's token is the whole authorisation, so nobody has to sign in. */
useHead({
  title: "Potwierdź zapis na newsletter - koryta.pl",
  meta: [{ name: "robots", content: "noindex" }],
});

const route = useRoute();

const params = computed(() => {
  const { s, t } = route.query;
  if (typeof s !== "string" || !s) return null;
  if (typeof t !== "string" || !t) return null;
  return { s, t };
});

const saving = ref(false);
const outcome = ref<"confirmed" | "alreadyConfirmed" | "invalid" | null>(null);
const error = ref("");

async function confirm() {
  if (!params.value) return;
  saving.value = true;
  error.value = "";
  try {
    const answer = await $fetch<{
      outcome: "confirmed" | "alreadyConfirmed" | "invalid";
    }>("/api/newsletter/confirm", { method: "POST", body: params.value });
    outcome.value = answer.outcome;
  } catch (failure) {
    error.value =
      (failure as { data?: { message?: string } } | null)?.data?.message ??
      "Nie udało się potwierdzić. Spróbuj ponownie za chwilę.";
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.confirm-page {
  max-width: 560px;
}

.confirm-page__done {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.confirm-page__done-icon {
  flex: none;
  margin-top: 1px;
}
</style>

<template>
  <div class="unsubscribe-page mx-auto w-100 py-6">
    <v-card rounded="lg">
      <v-card-item>
        <v-card-title class="text-h5 text-wrap">
          Wypisz się z wiadomości
        </v-card-title>
      </v-card-item>

      <v-card-text v-if="!params" class="text-body-1" data-unsubscribe-broken>
        Ten link jest niepełny. Otwórz go jeszcze raz z wiadomości albo zmień
        ustawienia w <NuxtLink to="/profil">profilu</NuxtLink>.
      </v-card-text>

      <v-card-text v-else-if="done" class="text-body-1">
        <v-alert type="success" variant="tonal" data-unsubscribe-done>
          Gotowe. Nie dostaniesz już wiadomości na temat „{{ label }}” ani maili
          dla zespołu.
        </v-alert>
        <p class="mt-4">
          Jeśli to pomyłka, włączysz je z powrotem w
          <NuxtLink to="/profil">profilu</NuxtLink>.
        </p>
      </v-card-text>

      <template v-else>
        <v-card-text class="text-body-1">
          <p>
            Po kliknięciu przestaniemy wysyłać Ci wiadomości na temat „{{
              label
            }}”. Jeśli dostajesz od nas maile jako osoba z zespołu, te też się
            skończą. Powiadomień o Twoich własnych zmianach to nie dotyczy -
            nimi zarządzasz w <NuxtLink to="/profil">profilu</NuxtLink>.
          </p>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            class="mt-4"
            data-unsubscribe-error
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-0 ga-2">
          <v-btn
            color="ink-sage"
            variant="flat"
            :loading="saving"
            data-unsubscribe-confirm
            @click="confirm"
          >
            Wypisz mnie
          </v-btn>
          <v-btn variant="text" to="/">Zostaję</v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import {
  campaignTopicLabels,
  campaignTopics,
  type CampaignTopic,
} from "~~/shared/campaigns";

/** Where a campaign's "Wypisz się" lands. It asks before it acts: mail
 * scanners open every link in a message, and a page that unsubscribed on load
 * would take readers off the list for having received the mail at all. The
 * link's token is the whole authorisation, so nobody has to sign in. */
useHead({
  title: "Wypisz się - koryta.pl",
  meta: [{ name: "robots", content: "noindex" }],
});

const route = useRoute();

const params = computed(() => {
  const { u, t, k, c } = route.query;
  if (typeof u !== "string" || !u) return null;
  if (typeof t !== "string" || !t) return null;
  if (
    typeof k !== "string" ||
    !(campaignTopics as readonly string[]).includes(k)
  ) {
    return null;
  }
  return {
    u,
    t,
    k: k as CampaignTopic,
    ...(typeof c === "string" && c ? { c } : {}),
  };
});

const label = computed(() =>
  params.value ? campaignTopicLabels[params.value.k].title : "",
);

const saving = ref(false);
const done = ref(false);
const error = ref("");

async function confirm() {
  if (!params.value) return;
  saving.value = true;
  error.value = "";
  try {
    await $fetch("/api/mail/unsubscribe", {
      method: "POST",
      body: params.value,
    });
    done.value = true;
  } catch (failure) {
    error.value =
      (failure as { data?: { message?: string } } | null)?.data?.message ??
      "Nie udało się wypisać. Spróbuj ponownie za chwilę.";
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.unsubscribe-page {
  max-width: 560px;
}
</style>

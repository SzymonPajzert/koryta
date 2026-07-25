<template>
  <div class="profile-page w-100 mx-auto">
    <ClientOnly>
      <template v-if="user">
        <v-card class="mb-4" rounded="lg">
          <v-card-text
            class="d-flex flex-column flex-sm-row align-center ga-4 pa-6"
          >
            <v-avatar size="80" color="primary">
              <v-img v-if="photoURL" :src="photoURL" alt="Zdjęcie profilowe" />
              <span v-else class="text-h4">{{ initials }}</span>
            </v-avatar>
            <div class="text-center text-sm-left flex-grow-1">
              <div class="text-h5 mb-1">
                {{ user.displayName || "Bez nazwy" }}
              </div>
              <div class="text-body-2 text-medium-emphasis mb-2">
                {{ user.email }}
              </div>
              <div
                class="d-flex flex-wrap ga-2 justify-center justify-sm-start align-center"
              >
                <v-chip
                  size="small"
                  :color="user.emailVerified ? 'success' : 'warning'"
                  :prepend-icon="
                    user.emailVerified ? mdiCheckCircle : mdiAlertCircle
                  "
                >
                  {{
                    user.emailVerified
                      ? "Email zweryfikowany"
                      : "Email niezweryfikowany"
                  }}
                </v-chip>
                <v-btn
                  v-if="!user.emailVerified"
                  size="small"
                  variant="text"
                  color="primary"
                  :loading="sendingVerification"
                  @click="sendVerification"
                >
                  Wyślij email weryfikacyjny
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card class="mb-4" rounded="lg">
          <v-card-title>Twoje dane</v-card-title>
          <v-card-text>
            <v-form @submit.prevent="saveProfile">
              <v-text-field
                v-model="displayNameInput"
                label="Nazwa użytkownika"
                hint="Widoczna dla innych przy Twoich notatkach i zmianach"
                persistent-hint
                :rules="[(v) => !!v?.trim() || 'Nazwa nie może być pusta']"
                class="mb-4"
              />
              <v-btn
                type="submit"
                color="primary"
                :loading="savingProfile"
                :disabled="!profileDirty"
              >
                Zapisz zmiany
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>

        <v-card class="mb-4" rounded="lg">
          <v-card-title>Powiadomienia email</v-card-title>
          <v-card-subtitle class="text-wrap">
            Newsletter jest w przygotowaniu — wybierz już teraz, co chcesz
            otrzymywać, a odezwiemy się, gdy ruszy.
          </v-card-subtitle>
          <v-card-text>
            <v-switch
              v-model="newsletterRecentPeople"
              color="primary"
              label="Nowo znalezione osoby"
              hint="Powiadomienia o osobach niedawno dodanych do serwisu"
              persistent-hint
              :loading="savingNewsletter"
              @update:model-value="saveNewsletter"
            />
            <v-switch
              v-model="newsletterCallsToAction"
              color="primary"
              label="Wezwania do działania"
              hint="Informacje, gdzie Twoja pomoc jest najbardziej potrzebna"
              persistent-hint
              :loading="savingNewsletter"
              @update:model-value="saveNewsletter"
            />
          </v-card-text>
        </v-card>

        <v-card rounded="lg">
          <v-card-title>Konto</v-card-title>
          <v-card-text>
            <v-btn color="warning" variant="tonal" block @click="logout">
              Wyloguj się
            </v-btn>
          </v-card-text>
        </v-card>
      </template>

      <v-card v-else class="pa-6 text-center" rounded="lg">
        <v-progress-circular indeterminate class="mb-4" />
        <div>Ładowanie profilu...</div>
      </v-card>

      <template #fallback>
        <v-card class="pa-6 text-center" rounded="lg">
          <v-progress-circular indeterminate class="mb-4" />
          <div>Ładowanie profilu...</div>
        </v-card>
      </template>
    </ClientOnly>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="4000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { mdiCheckCircle, mdiAlertCircle } from "@mdi/js";
import { updateProfile, sendEmailVerification } from "firebase/auth";
import { set, ref as dbRef } from "firebase/database";
import { doc, setDoc } from "firebase/firestore";
import { useAuthState } from "@/composables/auth";

definePageMeta({
  middleware: "auth",
});

useHead({
  title: "Twój profil - koryta.pl",
});

const { user, userConfig, logout } = useAuthState();
const rtdb = useDatabase();
const firestore = useFirestore();

const photoURL = computed(
  () => userConfig?.data?.value?.photoURL || user.value?.photoURL,
);
const initials = computed(() => {
  const source = user.value?.displayName || user.value?.email || "?";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
});

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref<"success" | "error">("success");
const notify = (text: string, color: "success" | "error" = "success") => {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
};

// Display name editing
const displayNameInput = ref("");
const savingProfile = ref(false);

watch(
  user,
  (u) => {
    if (u && !displayNameInput.value) {
      displayNameInput.value = u.displayName || "";
    }
  },
  { immediate: true },
);

const profileDirty = computed(
  () =>
    !!displayNameInput.value.trim() &&
    displayNameInput.value.trim() !== (user.value?.displayName || ""),
);

const saveProfile = async () => {
  if (!user.value || !profileDirty.value) return;
  const name = displayNameInput.value.trim();
  savingProfile.value = true;
  try {
    await updateProfile(user.value, { displayName: name });
    // Keep the mirrors used elsewhere in sync (see login.vue).
    await Promise.all([
      set(dbRef(rtdb, `user/${user.value.uid}/displayName`), name),
      setDoc(
        doc(firestore, "users", user.value.uid),
        { displayName: name },
        { merge: true },
      ),
    ]);
    notify("Zapisano nazwę użytkownika.");
  } catch (err) {
    console.error("Failed to save profile:", err);
    notify("Nie udało się zapisać zmian. Spróbuj ponownie.", "error");
  } finally {
    savingProfile.value = false;
  }
};

// Newsletter preferences (placeholder - stored, no emails sent yet)
const newsletterRecentPeople = ref(false);
const newsletterCallsToAction = ref(false);
const savingNewsletter = ref(false);

watch(
  () => userConfig?.data?.value?.newsletter,
  (prefs) => {
    newsletterRecentPeople.value = !!prefs?.recentPeople;
    newsletterCallsToAction.value = !!prefs?.callsToAction;
  },
  { immediate: true },
);

const saveNewsletter = async () => {
  if (!user.value) return;
  savingNewsletter.value = true;
  try {
    await setDoc(
      doc(firestore, "users", user.value.uid),
      {
        newsletter: {
          recentPeople: newsletterRecentPeople.value,
          callsToAction: newsletterCallsToAction.value,
        },
      },
      { merge: true },
    );
    notify("Zapisano preferencje powiadomień.");
  } catch (err) {
    console.error("Failed to save newsletter preferences:", err);
    notify("Nie udało się zapisać preferencji.", "error");
  } finally {
    savingNewsletter.value = false;
  }
};

// Email verification
const sendingVerification = ref(false);
const sendVerification = async () => {
  if (!user.value) return;
  sendingVerification.value = true;
  try {
    await sendEmailVerification(user.value);
    notify("Wysłano email weryfikacyjny. Sprawdź swoją skrzynkę.");
  } catch (err) {
    console.error("Failed to send verification email:", err);
    notify("Nie udało się wysłać emaila weryfikacyjnego.", "error");
  } finally {
    sendingVerification.value = false;
  }
};
</script>

<style scoped>
.profile-page {
  max-width: 640px;
}
</style>

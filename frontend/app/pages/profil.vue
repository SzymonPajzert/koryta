<template>
  <div class="profile-page w-100 mx-auto">
    <ClientOnly>
      <template v-if="user">
        <v-card class="mb-4" rounded="lg">
          <v-card-text
            class="d-flex flex-column flex-sm-row align-center ga-4 pa-6"
          >
            <div class="avatar-wrapper">
              <v-avatar size="80" color="primary">
                <v-img
                  v-if="photoURL"
                  :src="photoURL"
                  alt="Zdjęcie profilowe"
                />
                <span v-else class="text-h4">{{ initials }}</span>
              </v-avatar>
              <v-btn
                class="avatar-edit"
                icon
                size="x-small"
                color="primary"
                aria-label="Zmień zdjęcie profilowe"
                :loading="avatarPending"
                @click="avatarInput?.click()"
              >
                <v-icon :icon="mdiCamera" />
              </v-btn>
              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="d-none"
                data-testid="avatar-input"
                @change="onAvatarPicked"
              />
            </div>
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
                <v-btn
                  v-if="hasOwnAvatar"
                  size="small"
                  variant="text"
                  color="warning"
                  :loading="avatarPending"
                  @click="removeAvatar"
                >
                  Usuń zdjęcie profilowe
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
          <v-card-title>Widoczność w statystykach i w aktywności</v-card-title>
          <v-card-subtitle class="text-wrap">
            Ranking na
            <NuxtLink to="/eksploruj/statystyki">stronie statystyk</NuxtLink>
            pokazuje, kto ile sprawdził, a strona Aktywność - kto co i kiedy
            zrobił. Nazwy są w nich ukryte, dopóki ich właściciele nie zdecydują
            inaczej.
          </v-card-subtitle>
          <v-card-text>
            <v-switch
              v-model="publicProfile"
              color="primary"
              :label="publicProfileLabel.title"
              :hint="publicProfileLabel.hint"
              persistent-hint
              :disabled="!profileVisibilityLoaded"
              :loading="savingVisibility || !profileVisibilityLoaded"
              @update:model-value="saveVisibility"
            />
            <!-- The name at stake is the one edited in the card above, so show
                 what it turns into rather than leaving it to be guessed. -->
            <div class="text-caption text-medium-emphasis mt-3">
              <!-- An account opened with an email and a password has no display
                   name until somebody sets one, and the ranking falls back to a
                   bare ordinal for it - so there is nothing to preview and
                   nothing this switch would reveal. Say that, rather than
                   printing an empty name. -->
              <template v-if="!ownDisplayName">
                Nie masz jeszcze nazwy użytkownika, więc w rankingu widnieje sam
                numer. Ustaw ją wyżej, a wrócimy do tego.
              </template>
              <template v-else-if="publicProfile">
                Inni widzą w rankingu i w aktywności
                <strong>{{ ownDisplayName }}</strong
                >.
              </template>
              <template v-else>
                Inni widzą w rankingu
                <strong>{{ maskedContributorName(ownDisplayName, 1) }}</strong
                >, a w aktywności „Anonim”. Swoje własne miejsce widzisz tak czy
                inaczej.
              </template>
            </div>
          </v-card-text>
        </v-card>

        <!-- What happened to the proposals comes before the switches that
             control the mail about them. -->
        <ProfileMyRevisions />

        <v-card class="mb-4" rounded="lg">
          <v-card-title>Powiadomienia</v-card-title>
          <v-card-subtitle class="text-wrap">
            Wysyłamy je na adres, którym się logujesz — tylko wtedy, gdy ktoś
            zajmie się czymś, co zaproponowałeś, albo zmienią się Twoje
            uprawnienia.
          </v-card-subtitle>
          <v-card-text>
            <v-alert
              v-if="user && !user.emailVerified"
              type="warning"
              variant="tonal"
              density="compact"
              class="mb-4"
              text="Dopóki nie potwierdzisz adresu email, nie wyślemy na niego żadnej wiadomości."
            />
            <v-switch
              v-for="kind in notificationKinds"
              :key="kind"
              v-model="notificationPrefs[kind]"
              color="primary"
              :label="notificationLabels[kind].title"
              :hint="notificationLabels[kind].hint"
              persistent-hint
              :disabled="!notificationsLoaded"
              :loading="savingNotifications || !notificationsLoaded"
              @update:model-value="saveNotifications"
            />
          </v-card-text>
        </v-card>

        <v-card class="mb-4" rounded="lg">
          <v-card-title>Newsletter</v-card-title>
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
import { mdiCheckCircle, mdiAlertCircle, mdiCamera } from "@mdi/js";
import {
  reload,
  updateProfile,
  sendEmailVerification,
  type User,
} from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { authRequest, useAuthState } from "@/composables/auth";
import { ImageUploadError, prepareImage } from "~/utils/imageUpload";
import {
  notificationDefaults,
  notificationEnabled,
  notificationKinds,
  notificationLabels,
  type NotificationKind,
} from "~~/shared/notifications";
import {
  maskedContributorName,
  publicProfileEnabled,
  publicProfileLabel,
} from "~~/shared/profile";

definePageMeta({
  middleware: "auth",
});

useHead({
  title: "Twój profil - koryta.pl",
});

const { user, userConfig, logout } = useAuthState();
// The database `useAuthState` reads the same document from, and the one the
// server checks before sending mail. See the note in composables/auth.ts.
const firestore = getFirestore(useFirebaseApp(), "koryta-pl");

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

// The user's own profile picture. The server stores it, records it as theirs
// and points the account and the users document at it
// (server/utils/avatars.ts); the header's picture follows the document live.
const avatarInput = ref<HTMLInputElement>();
const avatarPending = ref(false);

/** The picture is one we store, rather than Google's or none - the only kind
 * there is anything to remove. The same test as the server's `isOwnImage`;
 * the base only lets a relative url parse. */
const hasOwnAvatar = computed(() => {
  if (!photoURL.value) return false;
  try {
    return new URL(photoURL.value, "https://koryta.pl").pathname.startsWith(
      "/api/images/",
    );
  } catch {
    return false;
  }
});

/** What to tell the user about a change that failed: why the picture could
 * not be prepared, or why the server turned it down - an unconfirmed address,
 * a session that ran out. Not the message of a 400, which is the body
 * parser's report on a request the page built itself. */
const avatarError = (err: unknown, fallback: string) => {
  if (err instanceof ImageUploadError) return err.message;
  const { statusCode, data } = err as {
    statusCode?: number;
    data?: { message?: string };
  };
  return (statusCode === 401 || statusCode === 403) && data?.message
    ? data.message
    : fallback;
};

/** The server takes `email_verified` off the ID token, which keeps what it
 * was issued with: an address confirmed from the mail a minute ago, in
 * another tab, is still unconfirmed in the token this page holds. So for an
 * account the page knows as unconfirmed, ask Auth again - the header's chip
 * then says what Auth says now - and take a fresh token carrying the same. An
 * address still unconfirmed goes to the server all the same, and its refusal
 * is what the snackbar says. */
async function tokenKnowsConfirmedAddress(account: User) {
  if (account.emailVerified) return;
  await reload(account);
  await account.getIdToken(true);
}

/** The account the page holds keeps the picture it was loaded with until it
 * is reloaded: after a removal that leaves none, the page would fall back to
 * the very picture just deleted. Not fatal if it fails - the change is saved,
 * and the document above already shows it. */
async function reloadAccount(account: User) {
  try {
    await reload(account);
  } catch (err) {
    console.warn("Failed to reload the account after a picture change:", err);
  }
}

const onAvatarPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so picking the same file again still fires a change event.
  input.value = "";
  if (!file || !user.value) return;
  avatarPending.value = true;
  try {
    // Cropped to a square, scaled down and encoded again in the browser,
    // which also leaves a phone photo's location behind (`prepareImage`).
    const { dataUrl } = await prepareImage(file, "avatar");
    await tokenKnowsConfirmedAddress(user.value);
    await authRequest("/api/users/avatar", {
      method: "POST",
      body: { image: dataUrl },
    });
    await reloadAccount(user.value);
    notify("Zapisano zdjęcie profilowe.");
  } catch (err) {
    if (!(err instanceof ImageUploadError)) {
      console.error("Failed to upload a profile picture:", err);
    }
    notify(
      avatarError(err, "Nie udało się zapisać zdjęcia. Spróbuj ponownie."),
      "error",
    );
  } finally {
    avatarPending.value = false;
  }
};

const removeAvatar = async () => {
  if (!user.value) return;
  avatarPending.value = true;
  try {
    await authRequest("/api/users/avatar", { method: "DELETE" });
    await reloadAccount(user.value);
    notify("Usunięto zdjęcie profilowe.");
  } catch (err) {
    console.error("Failed to remove the profile picture:", err);
    notify(
      avatarError(err, "Nie udało się usunąć zdjęcia. Spróbuj ponownie."),
      "error",
    );
  } finally {
    avatarPending.value = false;
  }
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
    // Keep the mirror `useAuthState().userConfig` reads in sync with the auth
    // profile.
    await setDoc(
      doc(firestore, "users", user.value.uid),
      { displayName: name },
      { merge: true },
    );
    notify("Zapisano nazwę użytkownika.");
  } catch (err) {
    console.error("Failed to save profile:", err);
    notify("Nie udało się zapisać zmian. Spróbuj ponownie.", "error");
  } finally {
    savingProfile.value = false;
  }
};

// Whether this account's name may be shown next to its work in the public
// ranking. Off unless the owner says otherwise, and the server applies the same
// default when it builds the ranking - see `shared/profile.ts`.
const publicProfile = ref(false);
const savingVisibility = ref(false);

/** The name the ranking would use, which is the one edited above rather than
 * whatever was last saved - so the preview follows the field. */
const ownDisplayName = computed(
  () => displayNameInput.value.trim() || user.value?.displayName || "",
);

/** The stored config has arrived. Same guard as the notification switches, and
 * for the same reason: a toggle made before the read lands would write the
 * default over a choice already made. */
const profileVisibilityLoaded = computed(
  () => userConfig?.data?.value !== undefined,
);

watch(
  () => userConfig?.data?.value?.publicProfile,
  (choice) => {
    publicProfile.value = publicProfileEnabled(choice);
  },
  { immediate: true },
);

const saveVisibility = async () => {
  if (!user.value) return;
  savingVisibility.value = true;
  try {
    await setDoc(
      doc(firestore, "users", user.value.uid),
      { publicProfile: publicProfile.value },
      { merge: true },
    );
    notify(
      publicProfile.value
        ? "Twoja nazwa jest teraz widoczna w statystykach i w aktywności."
        : "Twoja nazwa jest znów zamazana w statystykach i w aktywności.",
    );
  } catch (err) {
    console.error("Failed to save profile visibility:", err);
    notify("Nie udało się zapisać ustawienia. Spróbuj ponownie.", "error");
  } finally {
    savingVisibility.value = false;
  }
};

// Notifications about this user's own contributions. Unlike the newsletter
// these are live: the server reads the same document before queueing a mail,
// and every kind defaults to on, so an untouched switch must start there too.
const notificationPrefs = reactive<Record<NotificationKind, boolean>>(
  Object.fromEntries(
    notificationKinds.map((kind) => [kind, notificationDefaults[kind]]),
  ) as Record<NotificationKind, boolean>,
);
const savingNotifications = ref(false);

/** Whether the stored config has arrived.
 *
 * Saving writes every kind at once, and the switches start at the defaults -
 * both on - so a toggle made before the document loads would write those
 * defaults over whatever the user had turned off. vuefire leaves the ref
 * `undefined` while the read is in flight and `null` for a user who has never
 * saved anything, so only the former is "not yet known". The switches stay
 * disabled until then; /profil is what the emails link to for opting out, so
 * it is reached cold more often than not.
 */
const notificationsLoaded = computed(
  () => userConfig?.data?.value !== undefined,
);

watch(
  () => userConfig?.data?.value?.notifications,
  (prefs) => {
    for (const kind of notificationKinds) {
      notificationPrefs[kind] = notificationEnabled(kind, prefs);
    }
  },
  { immediate: true },
);

const saveNotifications = async () => {
  if (!user.value) return;
  savingNotifications.value = true;
  try {
    await setDoc(
      doc(firestore, "users", user.value.uid),
      { notifications: { ...notificationPrefs } },
      { merge: true },
    );
    notify("Zapisano preferencje powiadomień.");
  } catch (err) {
    console.error("Failed to save notification preferences:", err);
    notify("Nie udało się zapisać preferencji.", "error");
  } finally {
    savingNotifications.value = false;
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

/* The camera sits on the avatar's lower right edge, over the picture it
   changes. */
.avatar-wrapper {
  position: relative;
}

.avatar-edit {
  position: absolute;
  right: -4px;
  bottom: -4px;
}
</style>

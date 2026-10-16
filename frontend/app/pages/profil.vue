<template>
  <div class="profile-page w-100">
    <!-- Outside <ClientOnly>, so the server render already has the page's
         title and nothing pops in above the cards on hydration. The page's
         title rather than the account's name, which can be missing („Bez
         nazwy” at 40px) or run to four lines at that size on a phone; the
         name heads the card under it instead. -->
    <AdminPageHead title="Twój profil" />

    <ClientOnly>
      <!-- The cards one section gap apart, as every page's top-level blocks
           are (edges.css `k-sections`), rather than 16px of `mb-4` each. -->
      <div v-if="user" class="k-sections">
        <v-card>
          <!-- Top-aligned, so the avatar heads the name it belongs to even
               when a long name and address run to several lines on a phone;
               centred, it drifted down beside the email. -->
          <v-card-text class="d-flex align-start ga-4">
            <!-- A picture that fails to load falls back to the initials, not
                 to an empty disc. -->
            <v-avatar :size="xs ? 56 : 72" color="primary">
              <v-img
                v-if="photoURL && !avatarFailed"
                :src="photoURL"
                alt="Zdjęcie profilowe"
                @error="avatarFailed = true"
              />
              <span v-else class="profile-page__initials">{{ initials }}</span>
            </v-avatar>
            <div class="profile-page__who">
              <h2 class="k-section-title text-break mb-1">
                {{ user.displayName || "Bez nazwy" }}
              </h2>
              <div class="text-body-2 text-medium-emphasis text-break mb-2">
                {{ user.email }}
              </div>
              <div class="d-flex flex-wrap ga-2 align-center">
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

        <v-card>
          <v-card-title tag="h2">Twoje dane</v-card-title>
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

        <v-card>
          <!-- Wrapping, where Vuetify keeps a card title to one line and cuts
               it off with an ellipsis - a title this long does not fit a
               phone's card. The bubble follows the last word inline, so it is
               never left alone at the far edge of a two-line title. Only the
               words are the h2: inside it, the bubble's „Co to jest: …” would
               be read out as part of the heading's name. -->
          <v-card-title class="text-wrap">
            <h2 class="card-heading">
              Widoczność w statystykach i w aktywności
            </h2>
            <InfoBubble label="Widoczność w statystykach i w aktywności">
              Nazwy są w nich ukryte, dopóki ich właściciele nie zdecydują
              inaczej. {{ publicProfileLabel.hint }}
            </InfoBubble>
          </v-card-title>
          <!-- The sentence with the link stays in the card: a bubble is a
               tooltip and cannot hold one. -->
          <v-card-subtitle class="text-wrap">
            Ranking na
            <NuxtLink to="/eksploruj/statystyki">stronie statystyk</NuxtLink>
            pokazuje, kto ile sprawdził, a strona Aktywność – kto co i kiedy
            zrobił.
          </v-card-subtitle>
          <v-card-text>
            <!-- No hint under it: what the switch means is in the bubble, and
                 the line below says what others see - one sentence in the
                 card rather than five, three of them at 12px. -->
            <v-switch
              v-model="publicProfile"
              color="primary"
              hide-details
              :label="publicProfileLabel.title"
              :disabled="!profileVisibilityLoaded"
              :loading="savingVisibility || !profileVisibilityLoaded"
              @update:model-value="saveVisibility"
            />
            <!-- The name at stake is the one edited in the card above, so show
                 what it turns into rather than leaving it to be guessed. -->
            <div class="text-body-2 text-medium-emphasis text-break mt-1">
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

        <v-card>
          <v-card-title tag="h2">Powiadomienia o Twoich zmianach</v-card-title>
          <v-card-subtitle class="text-wrap">
            Wysyłamy je na adres, którym się logujesz – tylko wtedy, gdy ktoś
            zajmie się czymś, co zaproponowałeś.
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
            <!-- Title and hint as one two-line label, so the hint sits under
                 its own switch's words rather than under the track, nearer
                 the next switch than its own. Still named by the title and
                 described by the hint, as Vuetify's hint was. -->
            <v-switch
              v-for="kind in notificationKinds"
              :key="kind"
              v-model="notificationPrefs[kind]"
              class="profile-switch"
              color="primary"
              hide-details
              :aria-labelledby="`profile-${kind}-title`"
              :aria-describedby="`profile-${kind}-hint`"
              :disabled="!notificationsLoaded"
              :loading="savingNotifications || !notificationsLoaded"
              @update:model-value="saveNotifications"
            >
              <template #label>
                <span class="profile-setting">
                  <span :id="`profile-${kind}-title`">{{
                    notificationLabels[kind].title
                  }}</span>
                  <span
                    :id="`profile-${kind}-hint`"
                    class="profile-setting__hint"
                    >{{ notificationLabels[kind].hint }}</span
                  >
                </span>
              </template>
            </v-switch>
          </v-card-text>
        </v-card>

        <v-card>
          <v-card-title tag="h2">Newsletter</v-card-title>
          <v-card-subtitle class="text-wrap">
            Newsletter jest w przygotowaniu – wybierz już teraz, co chcesz
            otrzymywać, a odezwiemy się, gdy ruszy.
          </v-card-subtitle>
          <v-card-text>
            <v-switch
              v-model="newsletterRecentPeople"
              class="profile-switch"
              color="primary"
              hide-details
              aria-labelledby="profile-recent-people-title"
              aria-describedby="profile-recent-people-hint"
              :loading="savingNewsletter"
              @update:model-value="saveNewsletter"
            >
              <template #label>
                <span class="profile-setting">
                  <span id="profile-recent-people-title"
                    >Nowo znalezione osoby</span
                  >
                  <span
                    id="profile-recent-people-hint"
                    class="profile-setting__hint"
                    >Powiadomienia o osobach niedawno dodanych do serwisu</span
                  >
                </span>
              </template>
            </v-switch>
            <v-switch
              v-model="newsletterCallsToAction"
              class="profile-switch"
              color="primary"
              hide-details
              aria-labelledby="profile-calls-to-action-title"
              aria-describedby="profile-calls-to-action-hint"
              :loading="savingNewsletter"
              @update:model-value="saveNewsletter"
            >
              <template #label>
                <span class="profile-setting">
                  <span id="profile-calls-to-action-title"
                    >Wezwania do działania</span
                  >
                  <span
                    id="profile-calls-to-action-hint"
                    class="profile-setting__hint"
                    >Informacje, gdzie Twoja pomoc jest najbardziej
                    potrzebna</span
                  >
                </span>
              </template>
            </v-switch>
          </v-card-text>
        </v-card>

        <v-card>
          <v-card-title tag="h2">Konto</v-card-title>
          <v-card-text>
            <v-btn color="warning" variant="tonal" block @click="logout">
              Wyloguj się
            </v-btn>
          </v-card-text>
        </v-card>
      </div>

      <!-- A line in the column under the title, where the cards will be, not
           a card of its own floating in the middle. -->
      <div
        v-else
        class="d-flex align-center ga-3 text-body-2 text-medium-emphasis"
      >
        <v-progress-circular indeterminate size="20" width="2" />
        Ładowanie profilu…
      </div>

      <template #fallback>
        <div class="d-flex align-center ga-3 text-body-2 text-medium-emphasis">
          <v-progress-circular indeterminate size="20" width="2" />
          Ładowanie profilu…
        </div>
      </template>
    </ClientOnly>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="4000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { mdiCheckCircle, mdiAlertCircle } from "@mdi/js";
import { useDisplay } from "vuetify";
import { updateProfile, sendEmailVerification } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { useAuthState } from "@/composables/auth";
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
const { xs } = useDisplay();
// The database `useAuthState` reads the same document from, and the one the
// server checks before sending mail. See the note in composables/auth.ts.
const firestore = getFirestore(useFirebaseApp(), "koryta-pl");

const photoURL = computed(
  () => userConfig?.data?.value?.photoURL || user.value?.photoURL,
);
/** The picture at `photoURL` did not load (a dead link, a revoked Google
 * photo). A new address gets its own try. */
const avatarFailed = ref(false);
watch(photoURL, () => {
  avatarFailed.value = false;
});
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
/* A settings column at a reading measure, on the page's left edge under the
   title rather than centred in the 1168px column with 260px of nothing on
   either side. */
.profile-page {
  max-width: 720px;
}

/* Lets a long name or an unbreakable email address break inside the row
   instead of pushing the card wider than a phone. */
.profile-page__who {
  flex: 1 1 auto;
  min-width: 0;
}

/* The words of a card title that carries a bubble, at the title's own 16/600:
   Vuetify's reset leaves an h2 the browser's 1.5em. Inline, so the bubble
   after it still follows the last word. */
.card-heading {
  display: inline;
  font: inherit;
}

/* The space before the bubble. Vue drops the newline between `</h2>` and the
   bubble, and whether the h2's own text keeps a trailing one is up to how
   prettier wraps it; a generated space collapses into that one if it is
   there, so the gap is one space either way. */
.card-heading::after {
  content: " ";
}

/* No elevation on the switch thumbs (edges.css: shadows are for what
   floats). Not Vuetify's `flat`: in 3.13 it also repaints the thumb in
   surface-variant, near-black, so every switch that is off read as the
   heaviest - and as „on” - mark on the page. A neutral hairline ring keeps
   the white thumb findable on the white card; on, it keeps its sage. */
.profile-page :deep(.v-switch:not(.v-switch--inset) .v-switch__thumb) {
  box-shadow: 0 0 0 1px var(--k-line-strong);
}

/* A switch with a hint: the track centres on the title's first line, so the
   hint can run under the title. Only these - on the one-line visibility
   switch it would lift the track above its label. */
.profile-switch :deep(.v-selection-control) {
  align-items: flex-start;
}

/* The hint belongs to its own switch: two lines of one label on the label's
   left edge, 2px under the title and well clear of the next switch. A 24px
   title line with 8px above it puts its centre on the 40px track's. */
.profile-setting {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.5;
  padding-block: 8px;
}

/* Prose at 14px rather than a 12px tracked message, in the same quiet grey
   the hint had. The label is at full opacity inside a selection control, so
   nothing fades it a second time. */
.profile-setting__hint {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  line-height: 1.45;
}

/* Two letters, on the type scale: 32 in the 72px avatar, 24 in the phone's
   56. */
.profile-page__initials {
  font-size: 32px;
  line-height: 1;
}

@media (max-width: 599.98px) {
  .profile-page__initials {
    font-size: 24px;
  }
}
</style>

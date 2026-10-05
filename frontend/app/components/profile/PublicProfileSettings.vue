<template>
  <div
    v-if="loaded"
    class="public-profile mt-4"
    data-testid="public-profile-settings"
  >
    <p v-if="!publicProfile" class="text-body-2 text-medium-emphasis mb-0">
      Publiczny profil jest wyłączony - nikt nie zobaczy strony z Twoją nazwą i
      liczbą Twoich ocen, notatek i propozycji.
    </p>

    <template v-else>
      <v-progress-linear
        v-if="loading && !settings"
        indeterminate
        color="primary"
      />

      <v-alert
        v-else-if="loadFailed && !settings"
        type="warning"
        variant="tonal"
        density="compact"
      >
        Nie udało się wczytać adresu Twojego profilu.
        <template #append>
          <v-btn
            size="small"
            variant="text"
            data-testid="public-profile-retry"
            @click="load"
          >
            Spróbuj ponownie
          </v-btn>
        </template>
      </v-alert>

      <template v-else-if="settings">
        <v-alert
          v-if="settings.hidden"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          Administrator ukrył Twój profil, więc jego strona się nie otwiera.
          Twoja nazwa w rankingu i w aktywności jest dalej widoczna.
        </v-alert>
        <div v-else-if="settings.path" class="text-body-2 mb-4">
          Twój publiczny profil:
          <NuxtLink :to="settings.path" class="font-weight-medium">
            koryta.pl{{ settings.path }}
          </NuxtLink>
        </div>

        <v-form @submit.prevent="saveHandle">
          <div class="d-flex flex-column flex-sm-row align-sm-start ga-3">
            <v-text-field
              v-model="handleInput"
              label="Adres profilu"
              prefix="koryta.pl/uczestnik/"
              variant="outlined"
              density="compact"
              autocomplete="off"
              spellcheck="false"
              :error-messages="handleError ? [handleError] : []"
              hint="Po zmianie stary adres przestanie działać."
              persistent-hint
              class="flex-grow-1"
            />
            <v-btn
              type="submit"
              color="primary"
              variant="tonal"
              :disabled="!canSave"
              :loading="savingHandle"
              data-testid="public-profile-save"
            >
              Zmień adres
            </v-btn>
          </div>
        </v-form>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { authRequest } from "~/composables/auth";
import { handleBodySchema, type OwnProfileSettings } from "~~/shared/userAdmin";

/** The public profile, under the switch that turns it on (/profil).
 *
 * Its own component rather than more of the page: the switch is the page's,
 * since it writes the `users` document the page already holds, while the
 * address lives on the server - `profiles/{uid}` and `profileHandles`, both
 * closed to the browser - and is read and changed through
 * `/api/users/profile`.
 *
 * Asking is also what gives a profile its handle: the server assigns one from
 * the display name the first time it is asked while the switch is on. So the
 * block asks only once the switch's write has landed (`saving` back to false),
 * or the server would still read the switch as off.
 */
const props = withDefaults(
  defineProps<{
    /** The switch, as the page holds it. */
    publicProfile: boolean;
    /** The switch's write is in flight. */
    saving?: boolean;
    /** The stored setting has arrived; until then `publicProfile` is the
     * default, not the person's choice. */
    loaded?: boolean;
  }>(),
  { saving: false, loaded: true },
);

const emit = defineEmits<{
  notify: [text: string, color: "success" | "error"];
}>();

const settings = ref<OwnProfileSettings | null>(null);
const loading = ref(false);
const loadFailed = ref(false);
const handleInput = ref("");
const savingHandle = ref(false);

async function load() {
  loading.value = true;
  loadFailed.value = false;
  try {
    settings.value = await authRequest<OwnProfileSettings>(
      "/api/users/profile",
      { method: "GET" },
    );
    handleInput.value = settings.value.handle ?? "";
  } catch (error) {
    console.error("Failed to load profile settings:", error);
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.loaded && props.publicProfile && !props.saving,
  (ready) => {
    if (ready) void load();
  },
  { immediate: true },
);

/** The field as the server will read it - trimmed and lowercased by the same
 * schema - so what is checked here is exactly what is checked there. */
const parsed = computed(() =>
  handleBodySchema.safeParse({ handle: handleInput.value }),
);
const wanted = computed(() =>
  parsed.value.success ? parsed.value.data.handle : null,
);

/** Why the address will not do, once it differs from the current one. The
 * current one is never wrong - it is what the account has. */
const handleError = computed(() => {
  if (parsed.value.success) return null;
  if (handleInput.value === (settings.value?.handle ?? "")) return null;
  return parsed.value.error.issues[0]?.message ?? null;
});

const canSave = computed(
  () =>
    !!wanted.value &&
    wanted.value !== settings.value?.handle &&
    !savingHandle.value,
);

/** The server's own words for the refusals a person can act on - taken, or
 * too many changes today - and a generic line for anything else. */
function refusal(error: unknown): string {
  const { statusCode, data } = error as {
    statusCode?: number;
    data?: { message?: unknown };
  };
  if (
    (statusCode === 409 || statusCode === 429) &&
    typeof data?.message === "string"
  ) {
    return data.message;
  }
  return "Nie udało się zmienić adresu profilu. Spróbuj ponownie.";
}

async function saveHandle() {
  if (!canSave.value || !wanted.value) return;
  savingHandle.value = true;
  try {
    settings.value = await authRequest<OwnProfileSettings>(
      "/api/users/profile/handle",
      { method: "POST", body: { handle: wanted.value } },
    );
    handleInput.value = settings.value.handle ?? "";
    emit("notify", "Zmieniono adres profilu.", "success");
  } catch (error) {
    console.error("Failed to change the profile handle:", error);
    emit("notify", refusal(error), "error");
  } finally {
    savingHandle.value = false;
  }
}
</script>

<template>
  <div>
    <!-- The activator is the page's to draw: /pomoc makes it a card among the
         other ways to help, /rozszerzenie a button inside its warning. Both get
         the same handles: `open`, the label, and the line that replaces the
         form once there is nothing to send. -->
    <slot
      name="activator"
      :open="open"
      :label="label"
      :summary="summary"
      :can-request="offersForm"
      :loading="loading"
    >
      <v-btn
        v-if="offersForm"
        color="primary"
        variant="flat"
        class="text-none"
        :prepend-icon="mdiAccountKeyOutline"
        :loading="loading"
        @click="open"
      >
        {{ label }}
      </v-btn>
      <p
        v-if="summary"
        class="text-body-2 mb-0"
        :class="{ 'mt-2': offersForm }"
      >
        {{ summary }}
      </p>
    </slot>

    <v-dialog v-model="dialog" max-width="560" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center text-wrap">
          Poproś o dostęp do narzędzi zespołu
          <v-spacer />
          <v-btn
            :icon="mdiClose"
            variant="text"
            size="small"
            aria-label="Zamknij"
            @click="dialog = false"
          />
        </v-card-title>

        <v-card-text>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ error }}
          </v-alert>

          <p v-if="!formShown" class="text-body-1 mb-0">{{ summary }}</p>

          <template v-else>
            <p class="text-body-2 mb-4">
              Rozszerzenie do przeglądarki, ekstrakcje z artykułów i import
              danych przyznają administratorzy. Napisz, kim jesteś i przy czym
              chcesz pomagać - a jeśli rozmawialiśmy już na Slacku, podaj swoją
              nazwę stamtąd.
            </p>

            <v-textarea
              v-model="reason"
              label="Dlaczego chcesz dostęp?"
              variant="outlined"
              rows="4"
              auto-grow
              :counter="ACCESS_REQUEST_REASON.max"
              persistent-counter
              :hint="`Co najmniej ${ACCESS_REQUEST_REASON.min} znaków.`"
              persistent-hint
              :error-messages="reasonError"
              autofocus
            />

            <p
              v-if="unverified"
              class="text-body-2 text-ink-warning mt-3 mb-0"
              data-testid="access-request-unverified"
            >
              Twój adres e-mail nie jest jeszcze potwierdzony. Potwierdź go na
              <NuxtLink to="/profil">stronie profilu</NuxtLink> - bez tego
              administratorzy nie mogą nadać uprawnień zespołu.
            </p>

            <p class="text-caption text-medium-emphasis mt-3 mb-0">
              Prośbę zobaczą administratorzy serwisu, razem z nazwą i adresem
              e-mail Twojego konta.
            </p>
          </template>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <template v-if="formShown">
            <v-btn variant="text" @click="dialog = false">Anuluj</v-btn>
            <v-btn
              color="primary"
              variant="flat"
              :loading="sending"
              :disabled="!reasonValid"
              @click="submit"
            >
              Wyślij prośbę
            </v-btn>
          </template>
          <v-btn v-else variant="text" @click="dialog = false">Zamknij</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <DialogLogin v-model="loginDialog" hide-activator @success="afterLogin" />

    <v-snackbar v-model="sentNotice" color="success" timeout="5000">
      Prośba wysłana - administratorzy odpowiedzą na koncie albo mailem.
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
/** „Poproś o dostęp”: a signed-in reader asking for the team's tools.
 *
 * The way in used to be a sentence - "O dostęp poproś mailem albo na Slacku" -
 * which left the owner to match an address in a message to an account by hand,
 * and left the reader with no idea whether anybody had read it. This files the
 * request against the account (`POST /api/users/access-request`), where the
 * administrators answer it on /admin/uzytkownicy, and then says where it
 * stands, so the reader is not tempted to ask twice.
 *
 * The form is shown only when the server would take it. Otherwise the button
 * gives way to one line - already sent, already granted, or when a dismissed
 * request may be renewed - and the dialog, if a page's own activator still
 * opens it, says the same line rather than offering a form the server would
 * refuse. A request the server refuses anyway (sent from another tab) is read
 * again, so the page catches up with the answer.
 */
import { computed, onMounted, ref, watch } from "vue";
import { mdiAccountKeyOutline, mdiClose } from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import { isoDay, longDate, warsawDate } from "~~/shared/dates";
import {
  ACCESS_REQUEST_REASON,
  type AccessRequestBody,
  type AccessRequestSource,
  type OwnAccessRequest,
} from "~~/shared/userAdmin";

const props = defineProps<{
  /** The page the button is on, recorded with the request. */
  source: AccessRequestSource;
}>();

const emit = defineEmits<{
  /** The account holds the tools already, though the page may not know it:
   * a token keeps the claims it was issued with for up to an hour. */
  hasAccess: [];
}>();

const URL = "/api/users/access-request";

const { user } = useAuthState();

const state = ref<OwnAccessRequest | null>(null);
const loading = ref(false);
const dialog = ref(false);
const loginDialog = ref(false);
const sentNotice = ref(false);
const reason = ref("");
const sending = ref(false);
const error = ref("");

/** The day an instant falls on in Warsaw, as the site prints days. */
const warsawDay = (iso: string) => longDate(warsawDate(new Date(iso)), "");

/** The first whole Warsaw day on which `iso` has passed.
 *
 * `retryAfter` is an instant - a week after the answer, to the minute - and
 * "od 12 października" read on the morning of the 12th, when the form would
 * still be refused until five in the afternoon, is a promise broken. The day
 * after is one that holds. */
const dayAfter = (iso: string) => {
  const day = isoDay(warsawDate(new Date(iso)));
  if (!day) return "";
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return longDate(next.toISOString().slice(0, 10), "");
};

/** Signed out, still asking, or asked and failed: the button stays, and the
 * server has the last word when the form is sent. */
const offersForm = computed(
  () => !user.value || state.value === null || state.value.canRequest,
);
const formShown = computed(() => state.value?.canRequest !== false);

const label = computed(() =>
  user.value ? "Poproś o dostęp" : "Zaloguj się i poproś o dostęp",
);

const summary = computed<string | null>(() => {
  const own = state.value;
  if (!user.value || !own) return null;
  if (own.hasAccess) return "Masz już dostęp do narzędzi zespołu.";
  const request = own.request;
  if (request?.status === "open") {
    return `Prośba wysłana ${warsawDay(request.createdAt)} - administratorzy odpowiedzą na koncie albo mailem.`;
  }
  if (request?.status === "nominated") {
    return "Zgłosiliśmy Cię do zespołu - dostęp pojawi się, gdy właściciel serwisu zatwierdzi zmianę.";
  }
  if (request?.status === "dismissed" && own.retryAfter) {
    return `Na razie nie przyznaliśmy Ci dostępu - możesz poprosić ponownie od ${dayAfter(own.retryAfter)}.`;
  }
  return null;
});

/** The same bounds as `accessRequestBodySchema`, counted the same way - after
 * trimming - so the button and the server agree on what is long enough. */
const reasonLength = computed(() => reason.value.trim().length);
const reasonValid = computed(
  () =>
    reasonLength.value >= ACCESS_REQUEST_REASON.min &&
    reasonLength.value <= ACCESS_REQUEST_REASON.max,
);
const reasonError = computed(() =>
  reasonLength.value > ACCESS_REQUEST_REASON.max
    ? [`Najwyżej ${ACCESS_REQUEST_REASON.max} znaków.`]
    : [],
);

/** Google accounts arrive verified; an address typed into the sign-up form
 * does not, and the nomination it is asking for is refused for one - anybody
 * may register with anybody's address. Said here, before the wait, rather
 * than after it. */
const unverified = computed(() => user.value?.emailVerified === false);

async function load() {
  if (!user.value) {
    state.value = null;
    return;
  }
  loading.value = true;
  try {
    state.value = await authRequest<OwnAccessRequest>(URL, { method: "GET" });
    if (state.value.hasAccess) emit("hasAccess");
  } catch (err) {
    console.error("Failed to read the access request", err);
    state.value = null;
  } finally {
    loading.value = false;
  }
}

// On the client only: the server renders without the reader's session, and a
// line about their request baked into the page would be somebody's.
onMounted(load);
watch(() => user.value?.uid, load);

function open() {
  if (!user.value) {
    loginDialog.value = true;
    return;
  }
  error.value = "";
  dialog.value = true;
}

/** Back from the login dialog, the request is opened rather than leaving the
 * reader to find the button again - with whatever the server says about this
 * account, which may already be "masz dostęp". */
async function afterLogin() {
  await load();
  error.value = "";
  dialog.value = true;
}

function serverMessage(err: unknown): string | null {
  const data = (err as { data?: { message?: unknown } }).data;
  return typeof data?.message === "string" ? data.message : null;
}

async function submit() {
  if (!reasonValid.value) return;
  sending.value = true;
  error.value = "";
  const body: AccessRequestBody = {
    reason: reason.value.trim(),
    source: props.source,
  };
  try {
    state.value = await authRequest<OwnAccessRequest>(URL, {
      method: "POST",
      body,
    });
    reason.value = "";
    dialog.value = false;
    sentNotice.value = true;
  } catch (err) {
    console.error("Failed to send the access request", err);
    error.value =
      serverMessage(err) ?? "Nie udało się wysłać prośby. Spróbuj jeszcze raz.";
    // A 409 or a 429 means this page's picture of the request was stale.
    await load();
  } finally {
    sending.value = false;
  }
}
</script>

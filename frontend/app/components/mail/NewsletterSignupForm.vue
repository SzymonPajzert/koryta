<template>
  <!-- The newsletter for readers without an account: an address, then the
       confirmation mail (server/utils/newsletterSubscribers.ts). Signed-in
       readers are asked in the sign-in flow and manage it on /profil, so the
       form is for nobody else. It renders on the server for everybody and
       goes away once a signed-in reader is known. -->
  <section
    v-if="open && !user"
    class="newsletter-signup"
    aria-labelledby="newsletter-signup-title"
    data-newsletter-signup
  >
    <div class="newsletter-signup__intro">
      <h2 id="newsletter-signup-title" class="newsletter-signup__title">
        <v-icon
          :icon="mdiEmailOutline"
          size="22"
          color="ink-sage"
          class="newsletter-signup__title-icon"
        />
        Newsletter koryta.pl
      </h2>
      <p class="newsletter-signup__lead">
        Raz na jakiś czas napiszemy, kogo ostatnio znaleźliśmy na stanowiskach w
        publicznych spółkach i gdzie przyda się pomoc. Konto nie jest potrzebne.
      </p>
    </div>

    <div class="newsletter-signup__action">
      <p
        v-if="sentTo"
        class="newsletter-signup__done"
        role="status"
        data-newsletter-signup-done
      >
        <v-icon
          :icon="mdiEmailCheckOutline"
          size="20"
          color="ink-sage"
          class="newsletter-signup__icon"
        />
        <span>
          Sprawdź skrzynkę {{ sentTo }}. Jeśli adres jest poprawny, czeka w niej
          link potwierdzający: zapis zacznie działać, gdy go klikniesz.
        </span>
      </p>

      <!-- No field has a `name`, as in the site's other forms: a click that
           lands before the page has hydrated is the browser's own submit,
           which would put the address in the URL. -->
      <form v-else novalidate @submit.prevent="submit">
        <div class="newsletter-signup__row">
          <v-text-field
            v-model="email"
            type="email"
            autocomplete="email"
            label="Twój adres e-mail"
            variant="outlined"
            density="comfortable"
            hide-details
            :error="!!error"
            :aria-describedby="error ? 'newsletter-signup-error' : undefined"
            class="newsletter-signup__field"
            data-newsletter-signup-email
          />
          <!-- Worded and rounded like the call to action's buttons above
               it, at the height of the field beside it. -->
          <v-btn
            type="submit"
            color="ink-sage"
            variant="flat"
            rounded="lg"
            height="48"
            :loading="sending"
            class="text-none newsletter-signup__submit"
            data-newsletter-signup-submit
          >
            Zapisz się
          </v-btn>
        </div>
        <p
          v-if="error"
          id="newsletter-signup-error"
          class="newsletter-signup__error"
          role="alert"
        >
          <v-icon
            :icon="mdiAlertCircleOutline"
            size="18"
            class="newsletter-signup__icon"
          />
          <span>{{ error }}</span>
        </p>
        <!-- Honeypot, as in the feedback form: hidden from people,
             irresistible to form-filling bots. Not `display: none`, which
             the better bots skip. -->
        <label class="newsletter-signup__trap" aria-hidden="true">
          Nie wypełniaj tego pola
          <input
            v-model="website"
            type="text"
            tabindex="-1"
            autocomplete="off"
          />
        </label>
        <p class="newsletter-signup__fine">
          Wyślemy link potwierdzający. Z każdego maila wypiszesz się jednym
          kliknięciem. Więcej w
          <NuxtLink to="/plik/polityka_prywatnosci"
            >polityce prywatności</NuxtLink
          >.
        </p>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  mdiAlertCircleOutline,
  mdiEmailCheckOutline,
  mdiEmailOutline,
} from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { trackGoal } from "~/composables/analytics";
import {
  looksLikeEmail,
  normaliseEmail,
  type NewsletterSignupPlace,
} from "~~/shared/newsletterSignup";

const props = withDefaults(
  defineProps<{
    where?: NewsletterSignupPlace;
  }>(),
  { where: "home" },
);

const user = useCurrentUser();
/** Off until site mail is delivered - see /api/newsletter/subscribe. */
const open = useRuntimeConfig().public.newsletterSignupOpen;

const email = ref("");
const website = ref("");
const sending = ref(false);
const error = ref("");
/** The address the confirmation went to, once it has. */
const sentTo = ref("");

async function submit() {
  error.value = "";
  const address = normaliseEmail(email.value);
  if (!looksLikeEmail(address)) {
    error.value = "Wpisz adres e-mail, np. jan@example.com.";
    return;
  }
  sending.value = true;
  try {
    await $fetch("/api/newsletter/subscribe", {
      method: "POST",
      body: { email: address, where: props.where, website: website.value },
    });
    sentTo.value = address;
    trackGoal("mail-prompt:answer", { answer: "yes", where: props.where });
  } catch (cause) {
    const message = (cause as { data?: { message?: string } }).data?.message;
    error.value = message || "Nie udało się zapisać. Spróbuj ponownie.";
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* In the frame the call to action above it has, so the two asks read as a
   pair (Szymon's pick of 2026-10-17 over a strip): the words on the left and
   the form on the right where there is room for both, one under the other on
   a phone. A step below the call to action - 18px against its 20 - since this
   is the second thing asked. */
.newsletter-signup {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  padding: 20px;
}

@media (min-width: 960px) {
  .newsletter-signup {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 32px;
    align-items: center;
    padding: 24px 32px;
  }
}

.newsletter-signup__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 6px;
}

.newsletter-signup__title-icon {
  flex: none;
}

.newsletter-signup__lead {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 1rem;
  line-height: 1.5;
  text-wrap: pretty;
  margin: 0;
}

.newsletter-signup__row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.newsletter-signup__field {
  flex: 1 1 auto;
  min-width: 0;
}

.newsletter-signup__submit {
  flex: none;
}

.newsletter-signup__fine {
  margin-top: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  line-height: 1.45;
  text-wrap: pretty;
}

.newsletter-signup__error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  color: rgb(var(--v-theme-ink-danger));
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.45;
}

.newsletter-signup__done {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 1rem;
  line-height: 1.5;
}

/* An address is one unbroken word, and some are longer than a phone. */
.newsletter-signup__done > span,
.newsletter-signup__error > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.newsletter-signup__icon {
  flex: none;
  margin-top: 2px;
}

/* Off-screen rather than hidden: bots that skip display:none still fill it. */
.newsletter-signup__trap {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

/* On a phone the button goes under the field, full width. */
@media (max-width: 599px) {
  .newsletter-signup__row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

<template>
  <!-- The newsletter question, wherever it is put: in the /login card and in
       the sign-in dialog right after somebody signs in or creates an account,
       and in the layout's card for a reader nobody has asked yet. One wording
       everywhere, so the answer means the same thing wherever it was given.
       It saves the answer itself and says what happened in `answered`; the
       host decides where to go next. -->
  <section
    class="newsletter-question"
    :class="{ 'newsletter-question--compact': compact }"
    :aria-labelledby="titleId"
    data-newsletter-question
    :data-where="where"
  >
    <p v-if="status" class="newsletter-question__status">
      <v-icon
        :icon="mdiCheckCircle"
        size="18"
        color="ink-sage"
        class="newsletter-question__status-icon"
      />
      <span>{{ status }}</span>
    </p>

    <component
      :is="titleTag"
      :id="titleId"
      ref="title"
      tabindex="-1"
      class="newsletter-question__title"
    >
      Chcesz dostawać nasz newsletter?
    </component>

    <p class="newsletter-question__lead">
      Raz na jakiś czas napiszemy, kogo ostatnio znaleźliśmy na stanowiskach w
      publicznych spółkach i gdzie Twoja pomoc przyda się najbardziej.
    </p>

    <div class="newsletter-question__actions">
      <v-btn
        color="ink-sage"
        variant="flat"
        :size="compact ? 'default' : 'large'"
        :loading="saving === 'yes'"
        :disabled="saving !== null"
        data-newsletter-yes
        @click="choose(true)"
      >
        Tak, zapisz mnie
      </v-btn>
      <v-btn
        variant="outlined"
        :size="compact ? 'default' : 'large'"
        :loading="saving === 'no'"
        :disabled="saving !== null"
        data-newsletter-no
        @click="choose(false)"
      >
        Nie, dziękuję
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-3"
      :text="error"
    />

    <p class="newsletter-question__fine">
      <template v-if="needsConfirmation">
        Piszemy tylko na potwierdzone adresy, więc po „Tak” wyślemy też link
        potwierdzający.
      </template>
      Z każdego maila wypiszesz się jednym kliknięciem. Więcej w
      <NuxtLink to="/plik/polityka_prywatnosci" target="_blank" rel="noopener"
        >polityce prywatności</NuxtLink
      >.
    </p>
  </section>
</template>

<script setup lang="ts">
import { mdiCheckCircle } from "@mdi/js";
import { useAuthState } from "@/composables/auth";
import { trackGoal } from "~/composables/analytics";
import {
  useNewsletterAskedOnSignIn,
  useNewsletterQuestion,
} from "~/composables/newsletter";
import {
  newsletterAnswerNote,
  type NewsletterAskPlace,
} from "~~/shared/campaigns";

const props = withDefaults(
  defineProps<{
    where: NewsletterAskPlace;
    /** A line above the question saying what just happened, e.g. that the
     * account was created. */
    status?: string;
    /** The heading level the host's outline needs. */
    titleTag?: "h1" | "h2" | "h3";
    /** The layout's corner card: smaller type and buttons. */
    compact?: boolean;
    /** A new account was sent its confirmation link a moment ago, so a yes
     * does not send another. */
    verificationSent?: boolean;
    /** Move focus to the question when it appears - for a host whose form
     * the question replaces, so focus does not fall back to the page. */
    autofocus?: boolean;
  }>(),
  {
    status: undefined,
    titleTag: "h2",
    compact: false,
    verificationSent: false,
    autofocus: false,
  },
);

const emit = defineEmits<{
  /** A button was pressed. The answer reaches the user document before the
   * save returns, so a host that shows this only while it is due has to hold
   * on to it from here, or it goes before `answered` can arrive. */
  choosing: [];
  answered: [result: { yes: boolean; note: string }];
}>();

const { user } = useAuthState();
const { answer } = useNewsletterQuestion();
const askedOnSignIn = useNewsletterAskedOnSignIn();

/** A yes would send the confirmation link too - say so before, not after. */
const needsConfirmation = computed(
  () => user.value?.emailVerified === false && !props.verificationSent,
);

const titleId = useId();
const title = useTemplateRef<HTMLElement>("title");
const saving = ref<"yes" | "no" | null>(null);
const error = ref("");

onMounted(() => {
  trackGoal("mail-prompt:shown", { where: props.where });
  if (props.where !== "prompt") askedOnSignIn.value = true;
  if (props.autofocus) title.value?.focus();
});

async function choose(yes: boolean) {
  saving.value = yes ? "yes" : "no";
  error.value = "";
  emit("choosing");
  try {
    const { awaitingConfirmation } = await answer(yes, props.where, {
      verificationSent: props.verificationSent,
    });
    emit("answered", {
      yes,
      note: newsletterAnswerNote({
        yes,
        awaitingConfirmation,
        email: user.value?.email,
      }),
    });
  } catch (cause) {
    console.error("Failed to save the newsletter answer:", cause);
    error.value = "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.";
  } finally {
    saving.value = null;
  }
}
</script>

<style scoped>
.newsletter-question__status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: rgb(var(--v-theme-ink-neutral));
}

/* An address is one unbroken word, and some are longer than a phone. */
.newsletter-question__status > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.newsletter-question__status-icon {
  flex: none;
  margin-top: 1px;
}

/* The one thing on the card: the size of the title the sign-in card had
   above the form this replaces. */
.newsletter-question__title {
  font-size: 1.5rem;
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: -0.01em;
  text-wrap: balance;
  margin-bottom: 8px;
}

.newsletter-question__title:focus {
  /* Focused by script so a screen reader starts here; it is not a control. */
  outline: none;
}

.newsletter-question__lead {
  font-size: 1rem;
  line-height: 1.5;
  text-wrap: pretty;
  margin-bottom: 20px;
}

/* Two answers of one width, side by side where they fit and stacked where
   they do not, so neither reads as the small print of the other. */
.newsletter-question__actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

.newsletter-question__fine {
  margin-top: 16px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: rgb(var(--v-theme-ink-neutral));
  text-wrap: pretty;
}

.newsletter-question--compact .newsletter-question__title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.newsletter-question--compact .newsletter-question__lead {
  font-size: 0.875rem;
  margin-bottom: 14px;
}

.newsletter-question--compact .newsletter-question__actions {
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}

.newsletter-question--compact .newsletter-question__fine {
  margin-top: 12px;
  font-size: 0.75rem;
}
</style>

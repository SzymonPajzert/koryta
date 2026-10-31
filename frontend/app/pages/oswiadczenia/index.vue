<template>
  <div class="ow" data-testid="declaration-page">
    <div class="sec-head ow-head">
      <h1 class="ow-title">Odczytaj datę urodzenia</h1>
      <InfoBubble label="Odczytaj datę urodzenia">
        <p class="mb-2">
          Radni, wójtowie, burmistrzowie i prezydenci miast co roku składają
          oświadczenia majątkowe, a urzędy publikują je w BIP-ie. To dokumenty
          publiczne.
        </p>
        <p class="mb-2">
          <template v-if="READ_NAMES">
            Pokazujemy Ci tylko wycięte z nich linijki: z datą urodzenia i z
            imieniem i nazwiskiem.
          </template>
          <template v-else>
            Pokazujemy Ci tylko wyciętą z nich linijkę z datą urodzenia.
          </template>
          Czytasz na ślepo - link do całego oświadczenia pojawia się dopiero po
          odpowiedzi.
        </p>
        <p class="mb-2">
          Każdy wycinek czyta kilka osób. Gdy dwie zalogowane osoby wpiszą tę
          samą datę, uznajemy ją za odczytaną, a jeśli zgadza się z datą osoby,
          której szkic mamy na stronie, strona może zostać opublikowana
          automatycznie - kilka osób dziennie.
        </p>
        <p class="mb-0">
          Bez konta też możesz czytać. Twoje odczyty zapisujemy wtedy w tej
          przeglądarce, a po założeniu konta przechodzą na nie i zaczynają się
          liczyć.
        </p>
      </InfoBubble>
    </div>

    <!-- Who is signed in is known in the browser only, and every crop is
         fetched there, with the reader's token or this browser's reader id:
         the server render draws the title and a placeholder, never a crop. -->
    <ClientOnly>
      <div v-if="!authReady" class="ow-work">
        <div class="ow-skeleton" />
      </div>

      <template v-else>
        <p class="ow-lead">
          Przepisz datę urodzenia z wycinka oświadczenia majątkowego tak, jak ją
          widzisz.
        </p>

        <section
          v-if="readSoFar > 0"
          class="ow-tally"
          data-testid="declaration-tally"
        >
          <dl class="ow-tally__figures">
            <div class="ow-tally__row" data-tally-row>
              <dt>Sprawdzono</dt>
              <dd>{{ polishNumber(readSoFar) }}</dd>
            </div>
            <div class="ow-tally__row" data-tally-row>
              <dt>Znaleziono</dt>
              <dd>{{ polishNumber(found) }}</dd>
            </div>
          </dl>
          <!-- The same column for a reader with an account and one without:
               the one is asked to sign in to keep what they find, the other
               shown whom they found. -->
          <div class="ow-tally__pitch">
            <div class="ow-tally__words">
              <p class="ow-tally__ask">{{ tallyTitle }}</p>
              <!-- In full beside the button on a wider screen; on a phone
                   behind the "?" -->
              <p class="ow-tally__info ow-tally__info--beside">
                {{ TALLY_INFO }}
              </p>
            </div>
            <div class="ow-tally__actions">
              <v-btn
                v-if="user"
                color="tally"
                variant="flat"
                rounded="lg"
                height="44"
                class="text-none ow-tally__action"
                to="/oswiadczenia/znalezione"
                data-testid="declaration-tally-found"
              >
                Zobacz listę
              </v-btn>
              <v-btn
                v-else
                color="tally"
                variant="flat"
                rounded="lg"
                height="44"
                class="text-none ow-tally__action"
                data-testid="declaration-tally-login"
                @click="openSignIn()"
              >
                Zaloguj się
              </v-btn>
              <v-btn
                variant="tonal"
                rounded="lg"
                width="34"
                min-width="34"
                height="34"
                class="ow-tally__more"
                :aria-label="
                  user ? 'Kogo liczymy jako znalezionego' : 'Po co się logować'
                "
                aria-controls="declaration-tally-info"
                :aria-expanded="tallyInfoOpen"
                data-testid="declaration-tally-more"
                @click="tallyInfoOpen = !tallyInfoOpen"
              >
                <v-icon :icon="mdiHelp" size="18" />
              </v-btn>
            </div>
          </div>
        </section>
        <div
          v-if="readSoFar > 0 && tallyInfoOpen"
          id="declaration-tally-info"
          class="ow-tally__info ow-tally__info--below"
          data-testid="declaration-tally-info"
        >
          <p class="ow-tally__ask">{{ tallyTitle }}</p>
          <p class="mb-0">{{ TALLY_INFO }}</p>
        </div>

        <div class="ow-work">
          <div
            v-if="loadState === 'idle' || loadState === 'loading'"
            class="ow-skeleton"
            aria-busy="true"
            aria-label="Wczytuję wycinki"
          />

          <div
            v-else-if="loadState === 'error'"
            ref="refused"
            class="ow-state"
            data-testid="declaration-error"
          >
            <!-- The server's reason when it gave one (a limit of the day, an
                 address to confirm), the page's own line when it did not
                 answer. -->
            <v-alert
              type="error"
              color="ink-danger"
              variant="tonal"
              density="compact"
            >
              <template v-for="(part, i) in loadFailureParts" :key="i">
                <span v-if="part.whole" class="text-no-wrap">{{
                  part.text
                }}</span>
                <template v-else>{{ part.text }}</template>
              </template>
            </v-alert>
            <v-btn
              v-if="retryable"
              ref="retry"
              class="mt-3 text-none"
              variant="tonal"
              data-testid="declaration-retry"
              @click="start"
            >
              Spróbuj ponownie
            </v-btn>
          </div>

          <template v-else>
            <OswiadczeniaTaskCard
              v-if="current"
              ref="card"
              :key="current.task.id"
              :task="current.task"
              :draft="current.draft"
              :autofocus="autofocus"
              @answer="answer"
            />

            <!-- Answers on their way and nothing to show meanwhile: the
                 reader outran the server, which is only ever a moment. -->
            <div
              v-else-if="!finished"
              class="ow-skeleton"
              aria-busy="true"
              aria-label="Wczytuję następny wycinek"
            />

            <section v-else class="ow-done" data-testid="declaration-done">
              <v-icon :icon="mdiCheckAll" size="36" class="ow-done__icon" />
              <h2 class="ow-done__title">
                {{
                  readAny
                    ? "Na razie wszystko odczytane"
                    : "Na razie nie ma nic do odczytania"
                }}
              </h2>
              <!-- Crops can still be open while none is left for this
                   reader: each waits for a second pair of eyes, never the
                   same ones twice. -->
              <p class="ow-done__text">
                <template v-if="readAny">Dziękujemy. </template>
                <template v-if="(open ?? 0) > 0">
                  Pozostałe wycinki czekają na odczyty innych osób, a nowe
                  pojawią się, gdy znajdziemy kolejne oświadczenia.
                </template>
                <template v-else>
                  Nowe wycinki pojawią się, gdy znajdziemy kolejne oświadczenia.
                </template>
              </p>
              <v-btn variant="tonal" class="text-none" to="/pomoc">
                Zobacz, w czym jeszcze możesz pomóc
              </v-btn>
            </section>

            <OswiadczeniaAnswered
              v-if="answered"
              :crop="answered"
              class="mt-3"
            />
          </template>
        </div>

        <!-- The tally's „Zaloguj się” signs the reader in here, in a dialog,
             never on /login: leaving the page would take with it a crop that
             came back with what the reader typed, which the account is to
             send. The dialog outlives the tally's button, for what it asks a
             reader who has just signed in. -->
        <DialogLogin v-model="signingIn" form="login" hide-activator />
      </template>

      <template #fallback>
        <div class="ow-work">
          <div class="ow-skeleton" />
        </div>
      </template>
    </ClientOnly>

    <!-- Vuetify holds a snackbar to 344 px at the least, wider than a 320 px
         phone's room for it and cutting off both ends of the line at 200%
         zoom; no narrower than that, unless the window is. A sign-in on
         screen, the tally's or the app bar's, has the bottom of the window
         for its note, and a line opened then would go over the dialog and
         the note: the line waits for both to go. -->
    <v-snackbar
      :model-value="!!failure && !signInOnScreen"
      color="error"
      :timeout="failureTimeout"
      min-width="min(344px, 100%)"
      data-testid="declaration-failure"
      @update:model-value="failure = ''"
    >
      <template v-for="(part, i) in failureParts" :key="i">
        <span v-if="part.whole" class="text-no-wrap">{{ part.text }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { mdiCheckAll, mdiHelp } from "@mdi/js";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import {
  claimStoredReadings,
  firstClaimRefusal,
  refusalOf,
  useDeclarationQueue,
} from "~/composables/declarationQueue";
import { polishNumber } from "~/composables/polish";
import { useSignInOnScreen } from "~/composables/signInOnScreen";
import { lineParts } from "~/utils/declarationReading";
import { READ_NAMES } from "~~/shared/declarations";

/**
 * /oswiadczenia: readers type the birth date off a line cut out of a
 * councillor's asset declaration, one crop at a time. Signed in or not:
 * without an account the readings are filed under
 * this browser's reader id and count for nothing until an account claims
 * them; with one that is a Google sign-in or a confirmed address they count
 * towards the agreement that can publish a page.
 *
 * The crop is the page. Everything else - who the declarations belong to, why
 * the page exists, what an agreed date does - is either withheld until the
 * crop is answered or kept behind the (i), and the reader's own count is one
 * quiet line rather than a score. The reading is blind: the task carries only
 * the unit and the office, and the link to the whole declaration, which names
 * the person, arrives with the answer (`DeclarationTask`).
 */

definePageMeta({
  // A task page: nothing in it is for a search result.
  robots: false,
  // A column of its own, centred like every page narrower than the layout's:
  // 880 px of work, and the layout's 16 px of padding on each side.
  maxWidth: 912,
});

// The site's title template adds „| Koryta.pl” itself.
useSeoMeta({
  title: "Odczytaj datę urodzenia",
  description:
    "Pomóż odczytać odręcznie wpisane daty urodzenia z oświadczeń majątkowych samorządowców.",
});

const user = useCurrentUser();
const authReady = useIsCurrentUserLoaded();

const {
  queue,
  open,
  mine,
  loadState,
  refusal,
  refilling,
  exhausted,
  inFlight,
  answered,
  given,
  failure,
  start,
  answer,
  reset,
  keepTyped,
} = useDeclarationQueue();

const current = computed(() => queue.value[0] ?? null);

/** How many crops this reader has read a date off, and how many people they
 * found that way: the tally at the top, which shows from the first reading
 * on. */
/** Why to sign in, or for a reader with an account where what they found
 * is: beside the button on a wider screen, and on a phone under the tally
 * behind its "?", title and all. */
const TALLY_INFO_TITLE = "Zaloguj się, by zapisać znalezione daty";
const TALLY_FOUND_TITLE = "Znalezione osoby zapisujemy na Twoim koncie";
const TALLY_INFO =
  "Gdy dwie osoby wpiszą tę samą datę, która zgadza się z datą z KRSu, stronę tej osoby publikujemy automatycznie.";
const tallyInfoOpen = ref(false);
const tallyTitle = computed(() =>
  user.value ? TALLY_FOUND_TITLE : TALLY_INFO_TITLE,
);

const readSoFar = computed(() => mine.value?.total ?? 0);
const found = computed(() => mine.value?.found ?? 0);

/** Whether asking again can help. A reader without an account whom the day
 * has turned away has two ways on: an account, which the tally and the app
 * bar offer and whose sign-in starts the queue again by itself, or
 * tomorrow; asked again before either, the server says the same. A signed-in
 * reader may try again once they have confirmed the address it asked for (a
 * request after a refusal takes a fresh token), and anybody may after a
 * failure the server gave no reason for. */
const retryable = computed(
  () => !(refusal.value?.status === 429 && !user.value),
);

/** Long enough to read: the server's reasons run to two sentences, which
 * five seconds, enough for the page's own one, are not. */
const failureTimeout = computed(() =>
  Math.max(5000, failure.value.length * 70),
);

/** The two failure lines, with their hyphenated words kept whole
 * (`lineParts`): „e-mail” is in the longest of the server's reasons. */
const loadFailureParts = computed(() =>
  lineParts(
    refusal.value?.message ?? "Nie udało się wczytać wycinków do odczytania.",
  ),
);
const failureParts = computed(() => lineParts(failure.value));

const finished = computed(
  () => exhausted.value && inFlight.value === 0 && !refilling.value,
);

/** Whether the reader has ever read a crop: a thank-you is for them only. */
const readAny = computed(() => given.value > 0 || (mine.value?.total ?? 0) > 0);

/** A phone's keyboard covers half the screen, so the first crop is shown
 * before the caret is put in the field; from the first answer on the reader
 * is typing anyway, and the keyboard stays up from crop to crop. */
const coarsePointer = ref(false);
const autofocus = computed(() => !coarsePointer.value || given.value > 0);

/** The tally's sign-in, in a dialog on the page. */
const signingIn = ref(false);
/** What had focus when the sign-in opened: the tally's button, for a reader
 * on a keyboard. */
let signInOpener: HTMLElement | null = null;
function openSignIn() {
  const active = document.activeElement;
  signInOpener =
    active instanceof HTMLElement && active !== document.body ? active : null;
  signingIn.value = true;
}

const card = useTemplateRef<{
  show: () => void;
  focus: () => void;
  typed: () => { date: string; name: string };
}>("card");
const refused = useTemplateRef<HTMLElement>("refused");
const retry = useTemplateRef<ComponentPublicInstance>("retry");

/** Set when the sign-in closed after signing the reader in, for the work to
 * take focus once the account's queue has answered (`loadState`). */
const backToWork = ref(false);

// The dialog has no activator to give focus back to, so left alone, focus
// falls to the page's body when it closes. Closed without a sign-in, it goes
// back to the button that opened it. After one, which takes the tally's
// button away, it goes to the work, once the account's queue has answered.
watch(signingIn, async (open) => {
  if (open) return;
  await nextTick();
  if (user.value) backToWork.value = true;
  else
    (signInOpener?.isConnected
      ? signInOpener
      : document.querySelector<HTMLElement>(
          '[data-testid="declaration-tally-login"]',
        )
    )?.focus();
  signInOpener = null;
});

// Back into the middle of the window, which the reader may have left for the
// tally's sign-in: the page changes under the dialog, and a phone can be
// left anywhere on it. To the date field, where a crop that came
// back waits with what was typed into it, with the caret in it on a phone
// only once the reader has answered (`autofocus`): the keyboard would cover
// the crop. Or, where the account's queue was turned down (an address nobody
// confirmed reads from the same room for the day as the stranger did), to
// the alert, with „Spróbuj ponownie” focused.
watch([backToWork, loadState], async ([wanted, state]) => {
  if (!wanted || (state !== "ready" && state !== "error")) return;
  backToWork.value = false;
  await nextTick();
  if (state === "error") {
    refused.value?.scrollIntoView({ block: "center" });
    (retry.value?.$el as HTMLElement | undefined)?.focus({
      preventScroll: true,
    });
  } else if (autofocus.value) {
    card.value?.focus();
  } else {
    card.value?.show();
  }
});

/** A sign-in dialog on screen, open or showing the note it closes with. */
const signInOnScreen = useSignInOnScreen();

// A line that is up as a sign-in opens goes with it: the reader is acting on
// it, and the dialog covers the work it is about. A line that comes while a
// sign-in is on screen waits for it (the snackbar's `model-value`).
watch(signInOnScreen, (onScreen) => {
  if (onScreen) failure.value = "";
});

/** The claim's refusal, until it can be said. After a sign-in in a dialog,
 * the tally's or the app bar's, the claim is turned down while the dialog
 * still asks the newsletter question, and the dialog's note („Konto
 * założone…”, or what the answer did) comes after it, where the line goes:
 * the line waits for both. Where another line has the place by then, or the
 * reader has left, it is said on a later visit: the claim is turned down on
 * every signed-in visit until the address is confirmed, and the line is said
 * once a browser session, the first time it is shown (`firstClaimRefusal`). */
const claimLine = ref("");
watch([claimLine, signInOnScreen], ([line, onScreen]) => {
  if (!line || onScreen) return;
  claimLine.value = "";
  if (!failure.value && firstClaimRefusal()) failure.value = line;
});

/** Moves what this browser read without an account onto the account. A
 * claim that fails keeps the reader id for the next signed-in visit
 * (`claimStoredReadings`), and only the 403 for an address nobody confirmed
 * says so (`claimLine`): the readings move once it is confirmed. The server
 * gives it only where this browser has readings to move, and answers 0 for
 * one that only looked. A claim that failed for a reason the server did not
 * give says nothing, and neither does a lapsed sign-in's 401: the queue,
 * asked next, is turned down the same way and says it in the alert. */
async function claim() {
  claimLine.value = "";
  try {
    await claimStoredReadings();
  } catch (err) {
    console.error("Failed to claim the readings made without an account", err);
    const reason = refusalOf(err);
    if (reason?.status === 403) claimLine.value = reason.message;
  }
}

/** Reads as whoever reads, once that is known, signed in or not. Signing in
 * from the tally's dialog or the app bar's keeps the page: the queue starts
 * over as the account's, with a crop that came back with what was typed into
 * it still first and the stranger's failure line gone, and what this browser
 * read without an account goes over to the account before the account's
 * queue is asked for. */
function readAsWhoeverReads() {
  watch(
    [authReady, user],
    async ([ready, signedIn], previous) => {
      if (!ready) return;
      const wasSignedIn = previous?.[1];
      if (signedIn && !wasSignedIn && loadState.value !== "idle") {
        const typed = card.value?.typed();
        if (typed) keepTyped(typed);
        reset();
      }
      if (signedIn) await claim();
      if (loadState.value === "idle") void start();
    },
    { immediate: true },
  );
}

// In the browser only, which is all `onMounted` runs in. The server knows
// neither the reader's token nor this browser's reader id, and a request
// without both is turned down (401), so asked there, every visit would log
// a failure; the server render draws a placeholder for the crop anyway.
onMounted(() => {
  coarsePointer.value = window.matchMedia("(pointer: coarse)").matches;
  readAsWhoeverReads();
});
</script>

<style scoped>
/* The page is a column of 880 px (`maxWidth` above): a date crop is about
   950 px, and nearly its own size is about as sharp as it gets. */
.ow {
  padding-block: 8px 48px;
  width: 100%;
}

.ow-work {
  margin-top: 20px;
}

/* What the reader did so far, split down the middle at every width: the two
   figures on a coloured pane on the left, as wide as they need, and on paper
   on the right the ask with its button, to sign in or to the list of whom
   the reader found. In Oliwka, from the palette rounds. */
.ow-tally {
  background: rgb(var(--v-theme-tally-pale));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  margin-top: 16px;
  overflow: hidden;
}

/* The two rows share one grid (their wrappers are `display: contents`), so
   the labels line up on the left and the figures on the right, one above the
   other, whatever the width of either. */
.ow-tally__figures {
  align-content: center;
  align-items: baseline;
  background: rgb(var(--v-theme-tally));
  color: rgb(var(--v-theme-on-tally));
  column-gap: 14px;
  display: grid;
  grid-template-columns: max-content max-content;
  justify-content: start;
  margin: 0;
  padding: 16px 24px;
  row-gap: 4px;
}

.ow-tally__row {
  display: contents;
}

.ow-tally__row dt {
  color: rgb(var(--v-theme-tally-pale));
  font-size: 0.9375rem;
  font-weight: 500;
}

.ow-tally__row dd {
  color: rgb(var(--v-theme-on-tally));
  font-size: 1.75rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0;
  text-align: right;
}

.ow-tally__pitch {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
  padding: 16px 20px;
}

.ow-tally__ask {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.4;
  margin: 0;
  text-wrap: pretty;
}

.ow-tally__action {
  letter-spacing: 0.01em;
}

.ow-tally__words {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ow-tally__actions {
  display: flex;
  flex: none;
  gap: 8px;
}

/* Smaller than the button beside it, which it serves, but still 44px to a
   thumb: the hit area runs 5px past the drawn one on every side. */
.ow-tally__more {
  align-self: center;
  color: rgb(var(--v-theme-ink-neutral));
}

.ow-tally__more::after {
  content: "";
  inset: -5px;
  position: absolute;
}

.ow-tally__info {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
  text-wrap: pretty;
}

/* Under the tally on a phone, in the tally's paper, when the „?” opens it. */
.ow-tally__info--below {
  display: grid;
  gap: 4px;
  background: rgb(var(--v-theme-tally-pale));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  margin-top: 8px;
  padding: 12px 16px;
}

/* On a phone the tally holds the button and its „?” alone; the words are
   behind the „?”. */
@media (max-width: 599.98px) {
  .ow-tally__words {
    display: none;
  }

  /* The button takes what the „?” leaves of the column, so the „?” sits at
     the paper's edge rather than with a gap after it. */
  .ow-tally__actions {
    width: 100%;
  }

  .ow-tally__action {
    flex: 1 1 auto;
  }
}

@media (min-width: 600px) {
  .ow-tally__more,
  .ow-tally__info--below {
    display: none;
  }
}

/* On a wider screen the ask and its button share one line and fill the
   paper; on a phone the ask stands above the button. */
@media (min-width: 600px) {
  .ow-tally__pitch {
    align-items: center;
    flex-direction: row;
    gap: 20px;
    justify-content: space-between;
    padding: 16px 24px;
  }

  .ow-tally__words {
    flex: 1 1 auto;
  }

  .ow-tally__action {
    flex: none;
  }
}

@media (max-width: 599.98px) {
  .ow-tally__figures {
    padding: 14px 16px;
  }

  .ow-tally__row dd {
    font-size: 1.5rem;
  }

  .ow-tally__pitch {
    padding: 14px 16px;
  }
}

.ow-head {
  flex-wrap: nowrap;
}

.ow-title {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0;
  text-wrap: balance;
}

.ow-lead {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 1rem;
  line-height: 1.5;
  margin: 8px 0 0;
  max-width: 68ch;
  text-wrap: pretty;
}

/* A crop's shape, held while one is on its way, so the page does not jump
   when it arrives. */
.ow-skeleton {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 10px;
  height: 320px;
}

/* The server's reason can be two sentences, and on a phone at 200% zoom the
   alert's text column, beside its icon, is narrower than „potwierdzonego”:
   a word that fits nowhere breaks rather than runs out of the alert. */
.ow-state {
  max-width: 560px;
  overflow-wrap: anywhere;
}

/* Sentence case, so the words are spaced as words. */
.ow-state .v-btn,
.ow-done .v-btn {
  letter-spacing: 0.01em;
}

.ow-done {
  border: 1px dashed rgba(var(--v-border-color), 0.3);
  border-radius: 10px;
  padding: 32px 24px;
  text-align: center;
}

.ow-done__icon {
  color: rgb(var(--v-theme-ink-success));
}

.ow-done__title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 8px 0 4px;
}

.ow-done__text {
  color: rgb(var(--v-theme-ink-neutral));
  margin: 0 auto 16px;
  max-width: 44ch;
}

@media (max-width: 599.98px) {
  .ow-title {
    font-size: 1.75rem;
  }

  .ow-lead {
    font-size: 0.9375rem;
  }

  .ow-skeleton {
    height: 380px;
  }
}
</style>

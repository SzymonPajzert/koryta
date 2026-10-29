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
          Pokazujemy Ci tylko wycięte z nich linijki: z datą urodzenia i z
          imieniem i nazwiskiem. Czytasz na ślepo - link do całego oświadczenia
          pojawia się dopiero po odpowiedzi.
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
        <p v-if="mine" class="ow-progress" data-testid="declaration-progress">
          <span>
            Twoje odczyty:
            <template v-if="mine.total > 0">
              dziś <b>{{ polishNumber(mine.today) }}</b
              >, razem
              <b>{{ polishNumber(mine.total) }}</b>
            </template>
            <template v-else>jeszcze żadnego</template>
          </span>
          <span class="ow-progress__sep" aria-hidden="true">·</span>
          <span>
            Do odczytania: <b>{{ polishNumber(open ?? 0) }}</b>
          </span>
        </p>

        <div class="ow-work">
          <div
            v-if="loadState === 'idle' || loadState === 'loading'"
            class="ow-skeleton"
            aria-busy="true"
            aria-label="Wczytuję wycinki"
          />

          <div v-else-if="loadState === 'error'" class="ow-state">
            <v-alert
              type="error"
              color="ink-danger"
              variant="tonal"
              density="compact"
            >
              Nie udało się wczytać wycinków do odczytania.
            </v-alert>
            <v-btn class="mt-3 text-none" variant="tonal" @click="start">
              Spróbuj ponownie
            </v-btn>
          </div>

          <template v-else>
            <OswiadczeniaTaskCard
              v-if="current"
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

        <!-- Under the work, never in its way: reading needs no account, and
             the banner says what one adds - that the readings count. -->
        <div v-if="!user" class="ow-login" data-testid="declaration-login">
          <ExploreLoginBanner
            :to="loginTarget"
            :signup-to="signupTarget"
            message="Czytasz bez konta. Twoje odczyty zapisujemy w tej przeglądarce - załóż konto, a przejdą na nie i zaczną się liczyć."
          />
        </div>
      </template>

      <template #fallback>
        <div class="ow-work">
          <div class="ow-skeleton" />
        </div>
      </template>
    </ClientOnly>

    <v-snackbar
      :model-value="!!failure"
      color="error"
      timeout="5000"
      @update:model-value="failure = ''"
    >
      {{ failure }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { mdiCheckAll } from "@mdi/js";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import {
  claimStoredReadings,
  useDeclarationQueue,
} from "~/composables/declarationQueue";
import { polishNumber } from "~/composables/polish";

/**
 * /oswiadczenia: readers type the birth date off a line cut out of a
 * councillor's asset declaration, one crop at a time. Signed in or not
 * (Szymon, bip-czytanie-r1): without an account the readings are filed under
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
});

// The site's title template adds „| Koryta.pl” itself.
useSeoMeta({
  title: "Odczytaj datę urodzenia",
  description:
    "Pomóż odczytać odręcznie wpisane daty urodzenia z oświadczeń majątkowych samorządowców.",
});

const route = useRoute();

const user = useCurrentUser();
const authReady = useIsCurrentUserLoaded();

const {
  queue,
  open,
  mine,
  loadState,
  refilling,
  exhausted,
  inFlight,
  answered,
  given,
  failure,
  start,
  answer,
  reset,
} = useDeclarationQueue();

const current = computed(() => queue.value[0] ?? null);

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

// Back to this page once signed in, the way a person's teaser sends a reader.
const loginTarget = computed(() => ({
  path: "/login",
  query: { redirect: route.fullPath },
}));
const signupTarget = computed(() => ({
  path: "/login",
  query: { ...loginTarget.value.query, konto: "nowe" },
}));

// Reading starts once it is known who reads, signed in or not. Signing in
// from the app bar's dialog lands here without a reload: what this browser
// read without an account goes over to the account first, then the queue
// starts again as the account's.
watch(
  [authReady, user],
  async ([ready, signedIn], previous) => {
    if (!ready) return;
    const wasSignedIn = previous?.[1];
    if (signedIn && !wasSignedIn && loadState.value !== "idle") {
      await claimStoredReadings().catch((err) => {
        console.error(
          "Failed to claim the readings made without an account",
          err,
        );
      });
      reset();
    } else if (signedIn) {
      await claimStoredReadings().catch(() => 0);
    }
    if (loadState.value === "idle") void start();
  },
  { immediate: true },
);

onMounted(() => {
  coarsePointer.value = window.matchMedia("(pointer: coarse)").matches;
});
</script>

<style scoped>
/* The page keeps the layout's column, as every working page does; only the
   work in it is narrower. A date crop is about 950 px, so 960 holds one at
   its own size, the sharpest it gets. */
.ow {
  padding-block: 8px 48px;
  width: 100%;
}

.ow-work {
  margin-top: 20px;
  max-width: 880px;
}

.ow-login {
  margin-top: 24px;
  max-width: 880px;
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

.ow-progress {
  align-items: baseline;
  color: rgb(var(--v-theme-ink-neutral));
  column-gap: 10px;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.875rem;
  margin: 10px 0 0;
}

.ow-progress b {
  color: rgb(var(--v-theme-ink-strong));
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.ow-progress__sep {
  opacity: 0.6;
}

/* A crop's shape, held while one is on its way, so the page does not jump
   when it arrives. */
.ow-skeleton {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 10px;
  height: 320px;
}

.ow-state {
  max-width: 560px;
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

  /* Two short lines rather than one that breaks after its separator. */
  .ow-progress {
    flex-direction: column;
  }

  .ow-progress__sep {
    display: none;
  }

  .ow-lead {
    font-size: 0.9375rem;
  }

  .ow-skeleton {
    height: 380px;
  }
}
</style>

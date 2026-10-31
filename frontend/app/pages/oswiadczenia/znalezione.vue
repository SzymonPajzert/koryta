<template>
  <div class="of" data-testid="declaration-finds-page">
    <NuxtLink to="/oswiadczenia" class="of-back">
      <v-icon :icon="mdiArrowLeft" size="16" />
      Odczytaj datę urodzenia
    </NuxtLink>
    <div class="sec-head of-head">
      <h1 class="of-title">Znalezione osoby</h1>
      <InfoBubble label="Znalezione osoby">
        <p class="mb-2">{{ FOUND_RULE }}</p>
        <p class="mb-0">
          Szkic publikujemy automatycznie, kilka dziennie, gdy dwie osoby wpiszą
          tę samą datę, która zgadza się z datą z KRSu. Szkic widzą tylko
          zalogowani, a opublikowaną stronę wszyscy.
        </p>
      </InfoBubble>
    </div>

    <!-- Whom the reader found is known in the browser only, where the token
         is: the server render draws the title and a placeholder. -->
    <ClientOnly>
      <p v-if="finds && finds.total > 0" class="of-lead">
        Dzięki Twoim odczytom znaleziono
        <strong>{{ polishNumber(finds.total) }}</strong>
        {{ plural(finds.total, "osobę", "osoby", "osób") }}.
        <!-- Past the list's length only: a page removed since is counted
             and not listed, and says nothing here. -->
        <template v-if="finds.total > FOUND_LIST_LIMIT">
          Pokazujemy ostatnie {{ polishNumber(finds.people.length) }}.
        </template>
      </p>

      <div class="of-work">
        <div
          v-if="state === 'loading'"
          class="of-skeleton"
          aria-busy="true"
          aria-label="Wczytuję znalezione osoby"
        />

        <div v-else-if="state === 'error'" class="of-state">
          <v-alert
            type="error"
            color="ink-danger"
            variant="tonal"
            density="compact"
            data-testid="declaration-finds-error"
          >
            Nie udało się wczytać listy. Spróbuj ponownie za chwilę.
          </v-alert>
          <v-btn class="mt-3 text-none" variant="tonal" @click="load">
            Spróbuj ponownie
          </v-btn>
        </div>

        <section
          v-else-if="!finds || finds.people.length === 0"
          class="of-empty"
          data-testid="declaration-finds-empty"
        >
          <h2 class="of-empty__title">Na liście nie ma jeszcze nikogo</h2>
          <p class="of-empty__text">{{ FOUND_RULE }}</p>
          <v-btn
            color="tally"
            variant="flat"
            rounded="lg"
            height="44"
            class="text-none of-action"
            to="/oswiadczenia"
          >
            Odczytaj datę urodzenia
          </v-btn>
        </section>

        <template v-else>
          <ul class="of-list" data-testid="declaration-finds">
            <li
              v-for="person in finds.people"
              :key="person.id"
              class="of-row"
              data-testid="declaration-find"
            >
              <div class="of-row__who">
                <NuxtLink
                  :to="generateEntityUrl('person', person.id, person.name)"
                  class="of-row__name"
                >
                  {{ person.name }}
                </NuxtLink>
                <p v-if="whereOf(person)" class="of-row__where">
                  {{ whereOf(person) }}
                </p>
              </div>
              <span
                class="of-row__state"
                :class="{ 'of-row__state--live': person.published }"
                data-testid="declaration-find-state"
              >
                <v-icon
                  v-if="person.published"
                  :icon="mdiCheck"
                  size="16"
                  class="of-row__icon"
                />
                {{ person.published ? "Opublikowana" : "Szkic" }}
              </span>
            </li>
          </ul>
          <v-btn
            color="tally"
            variant="flat"
            rounded="lg"
            height="44"
            class="text-none of-action mt-6"
            to="/oswiadczenia"
          >
            Czytaj dalej
          </v-btn>
        </template>
      </div>

      <template #fallback>
        <div class="of-work">
          <div class="of-skeleton" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { mdiArrowLeft, mdiCheck } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { claimStoredReadings } from "~/composables/declarationQueue";
import { polishNumber } from "~/composables/polish";
import { plural } from "~/utils/jobStyle";
import {
  FOUND_LIST_LIMIT,
  type DeclarationFind,
  type DeclarationFinds,
} from "~~/shared/declarations";
import { generateEntityUrl } from "~~/shared/slugs";

/**
 * /oswiadczenia/znalezione: the people a reader's readings found, which the
 * tally on /oswiadczenia counts as „Znaleziono” and links a signed-in reader
 * to. A reader without an account is asked there to sign in to keep what they
 * find; this is what signing in shows them. Signed-in readers only: whom a
 * browser found stays with it until an account claims it.
 */

definePageMeta({
  middleware: "auth",
  // Per reader: nothing in it is for a search result.
  robots: false,
});

// The site's title template adds „| Koryta.pl” itself.
useSeoMeta({ title: "Znalezione osoby" });

/** When a person counts as found (`creditFinds`): at once, for a date the
 * birth date on their page does not contradict. */
const FOUND_RULE =
  "Osoba trafia na tę listę od razu, gdy zapiszesz datę z jej oświadczenia, o ile na jej stronie nie ma innej daty urodzenia.";

const finds = ref<DeclarationFinds | null>(null);
const state = ref<"loading" | "error" | "ready">("loading");

async function load() {
  state.value = "loading";
  try {
    finds.value = await authRequest<DeclarationFinds>(
      "/api/declarations/found",
      { method: "GET", timeout: 20_000 },
    );
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

/** Where the declaration whose crop found the person was filed: „Strzelin ·
 * Rada gminy · oświadczenie za 2023 r.”, as much of it as is known. */
function whereOf(person: DeclarationFind): string {
  return [
    person.unit,
    person.office,
    person.declarationYear
      ? `oświadczenie za ${person.declarationYear} r.`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// A reader who signed in on the way here, from /login rather than from the
// reading page, may still have readings filed under this browser: they are
// moved onto the account first, so what they found is on the list. A claim
// turned down (an address nobody confirmed) leaves the list as the account
// has it; the reading page says why.
onMounted(async () => {
  try {
    await claimStoredReadings();
  } catch {
    // Said on /oswiadczenia, where the readings are.
  }
  await load();
});
</script>

<style scoped>
.of {
  padding-block: 8px 48px;
  width: 100%;
}

.of-back {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: inline-flex;
  font-size: 0.875rem;
  font-weight: 500;
  gap: 4px;
  margin-bottom: 8px;
  text-decoration: none;
}

.of-back:hover,
.of-back:focus-visible {
  color: rgb(var(--v-theme-ink-strong));
  text-decoration: underline;
}

.of-head {
  flex-wrap: nowrap;
}

.of-title {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0;
  text-wrap: balance;
}

.of-lead {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 1rem;
  line-height: 1.5;
  margin: 8px 0 0;
  max-width: 68ch;
  text-wrap: pretty;
}

.of-lead strong {
  color: rgb(var(--v-theme-ink-strong));
  font-variant-numeric: tabular-nums;
}

.of-work {
  margin-top: 20px;
  max-width: 880px;
}

.of-skeleton {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 10px;
  height: 240px;
}

.of-state {
  max-width: 560px;
  overflow-wrap: anywhere;
}

/* One list on paper, as the tally's: a hairline between the people rather
   than a card each. */
.of-list {
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  list-style: none;
  margin: 0;
  overflow: hidden;
  padding: 0;
}

.of-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  justify-content: space-between;
  padding: 14px 20px;
}

.of-row + .of-row {
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
}

.of-row__who {
  flex: 1 1 260px;
  min-width: 0;
}

.of-row__name {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.of-row__name:hover,
.of-row__name:focus-visible {
  text-decoration: underline;
}

.of-row__where {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.45;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.of-row__state {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: inline-flex;
  flex: none;
  font-size: 0.8125rem;
  font-weight: 500;
  gap: 4px;
}

/* A page everybody may see: in the tally's green. */
.of-row__state--live {
  color: rgb(var(--v-theme-tally));
}

.of-action {
  letter-spacing: 0.01em;
}

.of-empty {
  border: 1px dashed rgba(var(--v-border-color), 0.3);
  border-radius: 10px;
  padding: 32px 24px;
  text-align: center;
}

.of-empty__title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 4px;
}

.of-empty__text {
  color: rgb(var(--v-theme-ink-neutral));
  margin: 0 auto 16px;
  max-width: 48ch;
  text-wrap: pretty;
}

@media (max-width: 599.98px) {
  .of-title {
    font-size: 1.75rem;
  }

  .of-lead {
    font-size: 0.9375rem;
  }

  .of-row {
    padding: 12px 16px;
  }

  /* The state under the person in every row: a short „Szkic” would fit
     beside the name, and the rows would stop lining up. */
  .of-row__who {
    flex-basis: 100%;
  }
}
</style>

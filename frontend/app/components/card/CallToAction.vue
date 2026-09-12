<template>
  <v-card
    ref="root"
    flat
    rounded="lg"
    class="pa-5 pa-md-8 cta"
    data-testid="home-help-cta"
  >
    <!-- The heading, the buttons and the caption do not depend on the numbers,
         so they render whatever /api/stats/progress does. Only the two things
         that would read „0 z 0” are gated - a failed or slow stats call must
         not cost the home page its only ask, and `routeRules` gives „/” an
         hour of `swr`, so whatever it renders is what the next reader gets. -->
    <div class="d-flex flex-column flex-md-row ga-6 ga-md-8 align-md-center">
      <div class="cta__say">
        <div class="sec-head mb-2">
          <v-icon
            :icon="mdiAccountSearchOutline"
            size="18"
            class="sec-head__icon"
          />
          <h2 class="text-h6 text-sm-h5 font-weight-bold">
            Zostało nam jeszcze dużo osób do sprawdzenia
          </h2>
          <InfoBubble label="Sprawdzanie osób">
            Sprawdzenie osoby polega na tym, żeby zobaczyć, gdzie pracowała,
            poszukać, czy w tle jest polityka, i ocenić w skali od -5 do +5, na
            ile ta posada wygląda na nagrodę za politykę. Nie musisz mieć
            pewności - liczy się kilka niezależnych ocen, nie jedna. Publikuje
            zawsze człowiek z redakcji.
          </InfoBubble>
        </div>

        <p v-if="total" class="text-body-2 cta__lead mb-0">
          Wiemy, kto ma posadę w publicznej spółce albo instytucji. To, czy
          dostał ją po znajomości, musi sprawdzić człowiek - a sprawdziliśmy
          dopiero {{ polishNumber(checked) }} z
          {{ polishCountingGenitive(total, "osoby", "osób") }}.
        </p>

        <div class="d-flex flex-wrap align-center ga-2 mt-5">
          <v-btn
            :append-icon="mdiArrowRight"
            color="ink-info"
            variant="flat"
            rounded="lg"
            class="text-none"
            to="/eksploruj/nowe"
            text="Sprawdź pierwszą osobę"
            @click="
              trackGoal('cta:task', { task: 'kolejka', from: 'home-cta' })
            "
          />
          <v-btn
            :prepend-icon="mdiMessageAlertOutline"
            variant="text"
            rounded="lg"
            class="text-none"
            text="Zgłoś błąd albo podrzuć pomysł"
            @click="openFeedback"
          />
          <v-btn
            :append-icon="mdiChevronRight"
            variant="text"
            rounded="lg"
            class="text-none"
            to="/pomoc"
            text="Wszystkie sposoby pomocy"
            @click="trackGoal('cta:pomoc', { from: 'home-cta' })"
          />
        </div>

        <!-- The account cost, said here rather than discovered at the other end
             of the primary button: /eksploruj/nowe carries `middleware: "auth"`,
             and this section used to sit under a page that promised the
             opposite. -->
        <p class="text-caption text-medium-emphasis cta__fine mt-4 mb-0">
          Sprawdzanie wymaga konta - zakładasz je w niecałą minutę, a po
          zalogowaniu wracasz prosto do kolejki. Zgłoszenie błędu nie wymaga
          konta. Możesz nas też
          <NuxtLink
            to="/pomoc#pieniadze"
            class="text-ink-info"
            @click="trackGoal('cta:pomoc', { from: 'home-cta-donate' })"
            >wesprzeć finansowo</NuxtLink
          >.
        </p>
      </div>

      <div v-if="total" class="cta__bar">
        <p class="text-caption text-medium-emphasis mb-1">
          Ile już sprawdziliśmy
        </p>
        <StatsCompositionBar :segments="segments" :summary="summary" />
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import {
  mdiAccountSearchOutline,
  mdiArrowRight,
  mdiChevronRight,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { useStats } from "~/composables/stats/useStats";
import { useFeedbackDialog } from "~/composables/feedbackDialog";
import { trackGoal } from "~/composables/analytics";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import { categorical, ink, status } from "~/utils/chartTheme";

/** The home page's one ask.
 *
 * It was reported by a first-time visitor, in three separate messages on the
 * same evening, and each of them is answered here:
 *
 * - „«Zostało nam jeszcze dużo osób» – do czego? Trochę z tego nie wynika o co
 *   chodzi, że chodzi o osoby do weryfikacji.” The heading gains the words the
 *   sentence was missing, and the lead under it says what the site already
 *   knows and why a person is needed at all. Her own „Potrzebujemy
 *   zweryfikować…” is not used: „potrzebować” with an infinitive is a calque,
 *   and „sprawdzać” is the verb the queue, the table and this bar already use.
 * - „«Albo zacznij działać» […] to trochę sztuczne rozróżnienie pomiędzy «Chcę
 *   pomóc» a «Zacznij działać».” It was: this file's own comment admitted both
 *   buttons „ask for the same thing”. There is one filled button now, and the
 *   two beside it lead somewhere genuinely different.
 * - „Bardzo dużo jest tego bladozielonego koloru.” The two elevated sage pills
 *   - the only two in the app - and the 2014-era red/green/blue progress chart
 *   are gone. The panel is `surface-info`, which is the site's „we are talking
 *   to you” colour, and the bar's largest segment is the neutral track.
 *
 * ## The number rule
 *
 * A count may appear in exactly two positions: after a preposition governing
 * the genitive, via `polishCountingGenitive` („z 9 394 osób”), or as a bare
 * label value with no verb agreeing with it. Never as the subject of a verb -
 * „Zostało 7 690 osób” is right and the same sentence needs „Zostały 7 692
 * osoby” two hires later, which is a bug that would be found by a reader
 * rather than by a test.
 *
 * ## Why `checked` and not `reviewed`
 *
 * The old copy printed `reviewed`, documented in `useStats` as „looked at by
 * somebody, not published yet”. That is the smallest of the three figures and
 * it *falls* every time somebody publishes one of them, so the sentence
 * „znaleźliśmy już N osób” went down as the project went forward.
 */
const { total, approved, reviewed, toCheck } = useStats();
const checked = computed(() => approved.value + reviewed.value);

// No `to` on any segment: the legend carries all three numbers, and every
// destination a segment could have lands a signed-out reader on /login or on
// an empty table - /api/nodes answers `visibility=private` with nothing at all
// unless you are signed in.
const segments = computed(() => [
  {
    key: "approved",
    label: "Opublikowane",
    value: approved.value,
    color: status.good,
    labelColor: "#ffffff",
  },
  {
    key: "reviewed",
    label: "Sprawdzone, nieopublikowane",
    value: reviewed.value,
    color: categorical[0],
    labelColor: "#ffffff",
  },
  {
    key: "toCheck",
    label: "Do sprawdzenia",
    value: toCheck.value,
    color: ink.track,
    labelColor: ink.secondary,
  },
]);

const summary = computed(
  () =>
    `Opublikowane: ${polishNumber(approved.value)}, sprawdzone: ` +
    `${polishNumber(reviewed.value)}, do sprawdzenia: ${polishNumber(toCheck.value)}`,
);

const feedbackOpen = useFeedbackDialog();
const openFeedback = () => {
  trackGoal("cta:task", { task: "zglos", from: "home-cta" });
  feedbackOpen.value = true;
};

// Fires when the section is scrolled into view, not on mount: on mount it
// would only restate the pageview. This section sits well below the fold, so
// the page's visitor count is not the denominator every `cta:*` goal needs.
const root = ref<{ $el: HTMLElement } | null>(null);
onMounted(() => {
  const el = root.value?.$el;
  if (
    !import.meta.client ||
    !el ||
    typeof IntersectionObserver === "undefined"
  ) {
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      trackGoal("cta:shown", { surface: "home" });
      observer.disconnect();
    },
    { threshold: 0.4 },
  );
  observer.observe(el);
  onBeforeUnmount(() => observer.disconnect());
});
</script>

<style scoped>
/* The tint is bound here rather than applied as `bg-surface-info`, because that
   class also sets `color: on-surface-info` and would paint every line of body
   copy blue. */
.cta {
  background: rgb(var(--v-theme-surface-info));
  border: 1px solid rgba(var(--v-theme-ink-info), 0.22);
}

/* A measure, not a width: the band this sits in is 1200px, and a line of body
   copy that long is read twice or not at all. */
.cta__lead {
  max-width: 62ch;
}

/* The small print is two lines of 12px; at Vuetify's caption line-height they
   set solid. */
.cta__fine {
  line-height: 1.6;
}

/* Only once the two are side by side. In the column the wrapper falls back to
   on a phone, `flex-basis` is a *height*, so a 320px basis on the bar left
   200px of empty tint under a legend three lines tall. */
@media (min-width: 960px) {
  .cta__say {
    flex: 1 1 auto;
  }

  /* Narrow, and allowed to shrink but not grow. It holds a 12px bar and three
     legend rows; at the 460px it used to take, the three buttons beside it had
     nowhere to sit and wrapped, leaving „Wszystkie sposoby pomocy” alone on a
     second line looking like an afterthought rather than a third option. */
  .cta__bar {
    flex: 0 1 320px;
  }
}
</style>

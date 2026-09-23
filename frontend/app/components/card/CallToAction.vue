<template>
  <section
    class="cta"
    :class="{ 'cta--bare': !total }"
    aria-labelledby="home-cta-title"
    data-testid="home-help-cta"
  >
    <!-- From md the card is a 2x2 grid - [figures | pitch] over [bar |
         small print] - so the two bottom strips share one top line. The DOM
         puts the heading first, which is the order a screen reader wants;
         the grid areas are what draw the figures first. -->
    <div class="cta__body">
      <!-- The heading is inline so the (i) follows its last word instead of
           dropping onto a line of its own when the heading wraps. -->
      <div class="cta__head">
        <h2 id="home-cta-title" class="cta__title">
          Zostało jeszcze dużo osób do sprawdzenia
        </h2>
        <InfoBubble label="Sprawdzanie osób">
          Sprawdzenie osoby polega na tym, żeby zobaczyć, gdzie pracowała,
          poszukać, czy w tle jest polityka, i ocenić w skali od -5 do +5, na
          ile ta posada wygląda na nagrodę za politykę. Nie musisz mieć pewności
          - liczy się kilka niezależnych ocen, nie jedna. Publikuje zawsze
          człowiek z redakcji.
        </InfoBubble>
      </div>

      <!-- One sentence per line from sm: a couplet rather than a 95-character
           line ending in a two-word stub. -->
      <p class="cta__lead">
        <span class="cta__lead-line"
          >Wiemy, kto ma posadę w publicznej spółce albo instytucji.</span
        >{{ " "
        }}<span class="cta__lead-line"
          >To, czy dostał ją po znajomości, musi sprawdzić człowiek.</span
        >
      </p>

      <div ref="actions" class="cta__actions">
        <v-btn
          :append-icon="mdiArrowRight"
          color="ink-info"
          variant="flat"
          rounded="lg"
          height="44"
          class="text-none cta__btn"
          to="/eksploruj/nowe"
          text="Sprawdź pierwszą osobę"
          @click="trackGoal('cta:task', { task: 'kolejka', from: 'home-cta' })"
        />
        <v-btn
          :prepend-icon="mdiMessageAlertOutline"
          variant="outlined"
          rounded="lg"
          height="44"
          class="text-none cta__btn cta__btn--quiet"
          @click="openFeedback"
        >
          Zgłoś błąd<span class="cta__optional">&nbsp;albo pomysł</span>
        </v-btn>
        <v-btn
          :append-icon="mdiChevronRight"
          color="ink-info"
          variant="text"
          rounded="lg"
          height="44"
          class="text-none cta__btn cta__btn--link"
          to="/pomoc"
          text="Inne sposoby pomocy"
          @click="trackGoal('cta:pomoc', { from: 'home-cta' })"
        />
      </div>
    </div>

    <!-- The account cost, said here rather than discovered at the other end
         of the primary button: /eksploruj/nowe carries `middleware: "auth"`,
         and this section used to sit under a page that promised the
         opposite. -->
    <div class="cta__fine">
      <p class="cta__fine-item">
        <v-icon
          :icon="mdiAccountCircleOutline"
          size="16"
          class="cta__fine-icon"
        />
        <span
          >Sprawdzanie wymaga konta - założysz je w minutę. Błąd zgłosisz bez
          konta.</span
        >
      </p>
      <NuxtLink
        to="/pomoc#pieniadze"
        class="cta__fine-item cta__donate"
        @click="trackGoal('cta:pomoc', { from: 'home-cta-donate' })"
      >
        <v-icon :icon="mdiHeartOutline" size="16" class="cta__fine-icon" />
        <span>Wesprzyj nas finansowo</span>
      </NuxtLink>
    </div>

    <!-- Only the figures wait for /api/stats/progress. A failed or slow call
         must not cost the home page its only ask, and `routeRules` gives „/”
         an hour of `swr`, so whatever it renders is what the next reader
         gets. Without figures the blue pane shrinks to a plain rail rather
         than printing „0 z 0”. -->
    <template v-if="total">
      <div class="cta__figures">
        <p class="cta__eyebrow">Sprawdziliśmy już</p>
        <!-- Two spans and a space, so the text reads „1 709 z 6 412 osób”
             whichever way the flex row wraps. -->
        <p class="cta__count">
          <span class="cta__checked">{{ polishNumber(checked) }}</span
          >{{ " "
          }}<span class="cta__total"
            >z {{ polishCountingGenitive(total, "osoby", "osób") }}</span
          >
        </p>

        <dl class="cta__legend">
          <div
            v-for="segment in segments"
            :key="segment.key"
            class="cta__legend-row"
          >
            <dt>
              <span
                class="cta__swatch"
                :class="`cta__seg--${segment.key}`"
                aria-hidden="true"
              />{{ segment.label }}
            </dt>
            <dd>{{ polishNumber(segment.value) }}</dd>
          </div>
        </dl>
      </div>

      <div class="cta__band">
        <div class="cta__bar" role="img" :aria-label="summary">
          <span
            v-for="segment in drawn"
            :key="segment.key"
            class="cta__seg"
            :class="`cta__seg--${segment.key}`"
            :style="{ width: (segment.value / total) * 100 + '%' }"
          />
        </div>
        <span class="cta__percent">{{ percent }}</span>
      </div>
    </template>
    <div v-else class="cta__rail" aria-hidden="true">
      <v-icon :icon="mdiAccountSearchOutline" size="28" />
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  mdiAccountCircleOutline,
  mdiAccountSearchOutline,
  mdiArrowRight,
  mdiChevronRight,
  mdiHeartOutline,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { useStats } from "~/composables/stats/useStats";
import { useFeedbackDialog } from "~/composables/feedbackDialog";
import { trackGoal } from "~/composables/analytics";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";

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
 *   are gone.
 *
 * ## The layout
 *
 * A split card: the figures on a solid `ink-info` pane, the ask on white. It
 * replaced a tinted card whose progress sat in a 260px column beside the copy -
 * a 12px label, a thin bar and a legend whose rows wrapped unevenly, centred
 * vertically so it lined up with nothing - over a paragraph of 12px small
 * print with the card's 32px of padding under it. The owner's words were
 * „misaligned”, „very narrow and hard to read on the computer” and „a big
 * padding”; this was chosen from four rendered proposals.
 *
 * So the progress is now the easiest thing on the card to read, the two panes
 * share their top line and their bottom strip, and the small print has a strip
 * of its own under the ask - one line on a wide desktop, wrapped at 960 and on
 * a phone. The bar is drawn here rather than by `StatsCompositionBar`: its
 * fills are the caller's, but its legend is set in dark on-surface ink, which
 * is unreadable on the blue pane, and it prints values inside the fills and
 * hangs a tooltip on every segment - none of which can be re-inked from
 * outside.
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

/** Whole percent, except at the two ends rounding would lie about: a first
 * handful of checks reads „<1%” rather than a discouraging „0%”, and the last
 * few people left read „>99%” rather than a „100%” printed beside a legend
 * that still lists them. */
const percent = computed(() => {
  if (!total.value) return "";
  const share = (checked.value / total.value) * 100;
  if (share > 0 && share < 1) return "<1%";
  if (share > 99 && share < 100) return ">99%";
  return `${Math.round(share)}%`;
});

// No link on any segment: the legend carries all three numbers, and every
// destination a segment could have lands a signed-out reader on /login or on
// an empty table - /api/nodes answers `visibility=private` with nothing at all
// unless you are signed in.
const segments = computed(() => [
  { key: "approved", label: "Opublikowane", value: approved.value },
  {
    key: "reviewed",
    label: "Sprawdzone, nieopublikowane",
    value: reviewed.value,
  },
  { key: "toCheck", label: "Do sprawdzenia", value: toCheck.value },
]);

/** An empty bucket would still draw its 3px minimum and its gap, so it is
 * left out of the bar - the legend still lists it. */
const drawn = computed(() => segments.value.filter((s) => s.value > 0));

const summary = computed(
  () =>
    `Sprawdzone ${percent.value}. Opublikowane: ${polishNumber(approved.value)}, ` +
    `sprawdzone, nieopublikowane: ${polishNumber(reviewed.value)}, ` +
    `do sprawdzenia: ${polishNumber(toCheck.value)}`,
);

const feedbackOpen = useFeedbackDialog();
const openFeedback = () => {
  trackGoal("cta:task", { task: "zglos", from: "home-cta" });
  feedbackOpen.value = true;
};

// Fires when the ask is scrolled into view, not on mount: on mount it would
// only restate the pageview. This section sits well below the fold, so the
// page's visitor count is not the denominator every `cta:*` goal needs.
//
// What is watched is the row of buttons, not the card. On a phone the figures
// pane comes first and is ~250px tall, so 40% of the card is on screen before
// the heading is - „shown” would count readers who turned back at the blue
// pane without ever seeing what it asks for.
const actions = ref<HTMLElement | null>(null);
onMounted(() => {
  const el = actions.value;
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
/* The pane is `ink-info`, and everything on it is measured against that:
   white text is 6.3:1 and `surface-info` (the pale labels) 5.17:1. The band
   under the figures is the same blue a shade darker (white on it 7.8:1),
   which is what makes the bar read as sitting in a groove rather than
   floating on the pane. */
.cta {
  --cta-pane: rgb(var(--v-theme-ink-info));
  --cta-pane-deep: #1a5296;
  --cta-pale: rgb(var(--v-theme-surface-info));
  --cta-pad-x: 20px;
  --cta-pad-y: 20px;
  --cta-pitch-x: 20px;

  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  display: grid;
  grid-template-areas: "figures" "band" "body" "fine";
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
}

.cta--bare {
  grid-template-areas: "rail" "body" "fine";
}

/* 960 is the tight case: a 304px pane leaves the ask 550px, and the three
   buttons need about 535 at 14px. A classic 17px scrollbar comes out of that
   before the media query notices - it measures the window, scrollbar
   included - so the text button gives up 8px of its own padding at this
   width too, further down. The legend's longest row needs 244 of the pane's
   256. */
@media (min-width: 960px) {
  .cta {
    --cta-pad-x: 24px;
    --cta-pad-y: 32px;
    --cta-pitch-x: 24px;
    grid-template-areas:
      "figures body"
      "band fine";
    grid-template-columns: 304px minmax(0, 1fr);
  }

  .cta--bare {
    grid-template-areas:
      "rail body"
      "rail fine";
    grid-template-columns: 88px minmax(0, 1fr);
  }
}

@media (min-width: 1280px) {
  .cta {
    --cta-pad-x: 32px;
    --cta-pitch-x: 40px;
    grid-template-columns: 36% minmax(0, 1fr);
  }

  .cta--bare {
    grid-template-columns: 88px minmax(0, 1fr);
  }
}

/* ---- the figures ---- */

.cta__figures {
  background: var(--cta-pane);
  color: #ffffff;
  grid-area: figures;
  padding: var(--cta-pad-y) var(--cta-pad-x) 20px;
}

.cta__eyebrow {
  color: var(--cta-pale);
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.5rem;
  margin: 0;
}

/* Flex so that a five-digit count pushes „z … osób” under the number rather
   than out of the pane. */
.cta__count {
  align-items: baseline;
  column-gap: 10px;
  display: flex;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  margin: 8px 0 0;
  row-gap: 6px;
}

.cta__checked {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.cta__total {
  color: var(--cta-pale);
  font-size: 1.125rem;
  font-weight: 500;
  white-space: nowrap;
}

/* Capped so that below 960, where the pane is the full width of the card, a
   number does not end up 800px from its label. The pane itself is never this
   wide, so the cap does nothing beside the ask. */
.cta__legend {
  display: grid;
  gap: 4px;
  margin: 16px 0 0;
  max-width: 24rem;
}

/* Pinned to the first line rather than centred, so a label that wraps - the
   long one does at 320px, and at 960 once the middle figure reaches four
   digits - keeps its swatch and its number beside its first line. */
.cta__legend-row {
  align-items: flex-start;
  display: flex;
  font-size: 0.875rem;
  gap: 12px;
  justify-content: space-between;
  line-height: 1.25rem;
}

.cta__legend dt {
  align-items: flex-start;
  color: var(--cta-pale);
  display: flex;
}

.cta__legend dd {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0;
}

/* The shape of a bar segment, so the key reads as a piece of the bar rather
   than as a row of checkboxes. */
.cta__swatch {
  border-radius: 99px;
  display: inline-block;
  flex: 0 0 auto;
  height: 8px;
  margin-right: 8px;
  margin-top: 6px;
  width: 14px;
}

@media (min-width: 960px) {
  .cta__figures {
    padding-bottom: 24px;
  }

  .cta__eyebrow {
    font-size: 1rem;
  }

  .cta__checked {
    font-size: 3rem;
  }

  .cta__total {
    font-size: 1.25rem;
  }

  .cta__legend {
    margin-top: 20px;
  }
}

@media (min-width: 1280px) {
  .cta__legend-row {
    font-size: 0.9375rem;
  }

  .cta__swatch {
    margin-right: 10px;
    width: 16px;
  }
}

/* ---- the bar ---- */

/* The shared grid row is what puts this and the small-print strip beside it
   on one top line. 12px of padding over a 20px line is the strip's own box,
   so the two are also the same height while the small print is one line;
   when it wraps, the row grows and the bar stays centred in it. */
.cta__band {
  align-items: center;
  background: var(--cta-pane-deep);
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  color: #ffffff;
  display: flex;
  gap: 12px;
  grid-area: band;
  padding: 12px var(--cta-pad-x);
}

.cta__bar {
  border-radius: 99px;
  display: flex;
  flex: 1 1 auto;
  height: 12px;
  overflow: hidden;
}

.cta__seg {
  height: 100%;
  min-width: 3px;
}

/* The 2px gap is what separates touching fills - never a border. */
.cta__bar .cta__seg:not(:last-child) {
  margin-right: 2px;
}

/* Fills only: which segment is which is carried by the legend's words and
   numbers, and none of these is the colour of any text. Published is the pale
   end of the site's green, checked-but-unpublished the pale end of its blue -
   the same meaning the two have on /eksploruj/statystyki, lightened until they
   hold 3:1 against the darker band (5.7:1 and 3.7:1) - and what is left is a
   recessed groove. */
.cta__seg--approved {
  background: #bfe6b8;
}

.cta__seg--reviewed {
  background: #8fb6ea;
}

.cta__seg--toCheck {
  background: rgba(4, 22, 52, 0.42);
}

/* On the pane the groove colour is almost the pane itself, so its swatch
   needs an outline to be seen at all. */
.cta__swatch.cta__seg--toCheck {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.cta__percent {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.25rem;
  min-width: 2.5em;
  text-align: right;
}

/* ---- without figures ---- */

/* A 6px band on a phone and a rail from md, so the card keeps its shape. The
   icon disc sits on the heading's line rather than in the middle of the rail. */
.cta__rail {
  background: var(--cta-pane);
  color: #ffffff;
  grid-area: rail;
  height: 6px;
}

.cta__rail :deep(.v-icon) {
  display: none;
}

@media (min-width: 960px) {
  .cta__rail {
    display: flex;
    height: auto;
    justify-content: center;
    padding-top: 26px;
  }

  .cta__rail :deep(.v-icon) {
    background: rgba(255, 255, 255, 0.14);
    border-radius: 50%;
    box-sizing: content-box;
    display: inline-flex;
    padding: 10px;
  }
}

/* ---- the ask ---- */

.cta__body {
  grid-area: body;
  min-width: 0;
  padding: 24px var(--cta-pitch-x) 20px;
}

.cta__head {
  font-size: 1.25rem;
  line-height: 1.3;
}

.cta__title {
  color: rgba(var(--v-theme-on-surface), 0.92);
  display: inline;
  font-size: inherit;
  font-weight: 700;
  letter-spacing: -0.005em;
  line-height: inherit;
  margin-right: 6px;
}

/* 0.54 rather than the global 0.38: the (i) is a control, so it needs 3:1. */
.cta__head :deep(.sec-head__info) {
  color: rgba(var(--v-theme-on-surface), 0.54);
  vertical-align: -2px;
}

.cta__lead {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 1rem;
  line-height: 1.5;
  margin: 12px 0 0;
}

.cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
}

/* Vuetify's 0.089em tracking is for upper case; sentence case wants none. */
.cta__btn {
  font-size: 0.9375rem;
  letter-spacing: 0;
}

.cta__btn--link {
  padding-inline: 12px;
}

.cta__btn--quiet {
  border-color: rgba(var(--v-border-color), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.87);
}

@media (min-width: 600px) {
  .cta__head {
    font-size: 1.5rem;
    line-height: 1.25;
  }

  /* Each sentence is ~410px, so from 600 both fit a line of their own. */
  .cta__lead-line {
    display: block;
  }
}

/* A phone stacks the three, full width, primary first. */
@media (max-width: 599px) {
  .cta__actions {
    align-items: stretch;
    flex-direction: column;
    margin-top: 20px;
  }

  /* The text button's own padding is the gap to the strip below. Important
     because `height` reaches the button as an inline style. */
  .cta__btn--link {
    height: 36px !important;
  }
}

@media (min-width: 960px) {
  .cta__body {
    padding: var(--cta-pad-y) var(--cta-pitch-x);
  }
}

/* The tight width again: three buttons in 550px only fit at 14px, with the
   second one saying just „Zgłoś błąd” and the third one's padding trimmed. */
@media (min-width: 960px) and (max-width: 1279px) {
  .cta__optional {
    display: none;
  }

  .cta__btn {
    font-size: 0.875rem;
  }

  .cta__btn--link {
    padding-inline: 8px;
  }
}

@media (min-width: 1280px) {
  .cta__lead {
    font-size: 1.0625rem;
  }
}

/* ---- the small print ---- */

.cta__fine {
  align-items: center;
  background: rgb(var(--v-theme-surface-muted));
  border-top: 1px solid rgba(var(--v-border-color), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.7);
  column-gap: 24px;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  grid-area: fine;
  justify-content: space-between;
  line-height: 1.25rem;
  min-width: 0;
  padding: 12px var(--cta-pitch-x);
  row-gap: 4px;
}

.cta__fine-item {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  margin: 0;
}

.cta__fine-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  opacity: 0.8;
}

.cta__donate {
  color: rgb(var(--v-theme-ink-info));
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.cta__donate span {
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>

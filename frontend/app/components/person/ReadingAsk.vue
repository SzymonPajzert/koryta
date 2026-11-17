<template>
  <!-- An aside, not part of the record: `data-nosnippet` keeps Google from
       quoting the ask in this person's search result, which should be about
       them. Drawn only in the experiment's arm that has it, and only once the
       figure is in, so the box arrives whole. -->
  <section
    v-if="shown"
    ref="root"
    class="ask px-2"
    aria-labelledby="person-reading-ask-title"
    data-nosnippet
    data-testid="person-reading-ask"
  >
    <!-- Dashed: the site's edge for what is not a record (`k-note`). -->
    <div class="ask-box">
      <div
        v-if="figure > 0"
        class="ask-figure"
        data-testid="person-reading-ask-figure"
      >
        <!-- The space is for whoever reads the text rather than the layout
             (a screen reader, a copy): without it the two run together as
             „741osób”. The flex gap draws the visible one. -->
        <span class="ask-figure__value">{{ polishNumber(figure) }}</span
        >{{ " " }}<span class="ask-figure__label">{{ figureLabel }}</span>
      </div>
      <div class="ask-box__words">
        <h3 id="person-reading-ask-title" class="ask-box__title">
          {{ title }}
        </h3>
        <p class="ask-box__body">{{ BODY }}</p>
      </div>
      <v-btn
        :append-icon="mdiChevronRight"
        color="secondary"
        border
        flat
        rounded="lg"
        height="44"
        class="ask-box__go text-none"
        to="/oswiadczenia"
        data-testid="person-reading-ask-go"
        @click="onGo"
      >
        Odczytaj skany
      </v-btn>
    </div>
  </section>
</template>

<script setup lang="ts">
/** The ask under a person's history, for a reader who is not signed in: read
 * the birth date off a few scans of asset declarations on /oswiadczenia. No
 * account is needed there, and a date that matches the register publishes
 * the person, so the ask leads with how many were published in the last 30
 * days - and on a page the automation published, says that pages like it come
 * from readers (round osoba-skany-r1, look c; wording from round r2).
 *
 * Person pages are where readers arrive: Google landed 33 a weekday on them in
 * November, and until now none of them was asked anything.
 *
 * Half of the readers get it (`PERSON_ASK_EXPERIMENT`, decided 2026-11-17), so
 * whether it puts them off the rest of the page can be measured against the
 * half that does not. The arm is settled in the browser, and the server
 * renders the control: the page without the box. The parent mounts this only
 * for a reader known not to be signed in, so an account never joins the split.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mdiChevronRight } from "@mdi/js";
import { usePersonDeclarations } from "~/composables/personDeclarations";
import { trackGoal } from "~/composables/analytics";
import { useExperimentArm } from "~/composables/experiments";
import { PERSON_ASK_EXPERIMENT } from "~~/shared/experiments";
import { polishNumber } from "~/composables/polish";
import { plural } from "~/utils/jobStyle";

const props = defineProps<{ nodeId: string }>();

/** A no-break space: Polish keeps a one-letter word on the line of the word
 * after it, as `DeclarationNote` does. */
const NBSP = "\u00a0";

const BODY = `Przepisz daty urodzenia z${NBSP}kilku skanów oświadczeń. Jeśli będą pasować do danych z${NBSP}KRS-u, automatycznie opublikujemy te osoby.`;

const { data: declarations } = usePersonDeclarations(props.nodeId);

/** On a page the automation published, a word about pages like it rather
 * than about this one: since 11-16 an OCR date that matches the page settles
 * its crop without readers, so this very page may owe readers nothing (round
 * osoba-skany-r2). */
const title = computed(() =>
  declarations.value?.autoPublished
    ? "Strony jak ta powstały dzięki czytelnikom"
    : "Masz minutę?",
);

/** Which half of the split this reader is in: the control (`bez`) until the
 * browser has settled it, so the server's render never has the box. */
const arm = useExperimentArm(PERSON_ASK_EXPERIMENT);

/** The people the declarations' automation published in the last 30 days,
 * from the public activity stats, cached for five minutes (`stats-activity`)
 * and shared by key across pages. Asked only in the ask's arm; the box waits
 * for it, so the figure never pushes the box apart after it is up. Without it
 * the box simply leads with its words. */
const {
  data: figureData,
  status: figureStatus,
  execute: loadFigure,
} = useAsyncData(
  "person-reading-ask-figure",
  () =>
    $fetch<{ automatic?: number }>("/api/stats/activity", {
      query: { days: 30 },
    })
      .then((stats) => stats.automatic ?? 0)
      .catch(() => 0),
  { server: false, immediate: false, default: () => 0 },
);
watch(
  arm,
  (value) => {
    if (value === "prosba" && figureStatus.value === "idle") void loadFigure();
  },
  { immediate: true },
);
const figure = computed(() => figureData.value ?? 0);

const shown = computed(
  () =>
    arm.value === "prosba" &&
    (figureStatus.value === "success" || figureStatus.value === "error"),
);
/** Only that (round osoba-skany-r3): the title and the words beside it say
 * the rest. In the count's own form - „1 opublikowana osoba”, „3 opublikowane
 * osoby”, „941 opublikowanych osób”. */
const figureLabel = computed(() =>
  plural(
    figure.value,
    "opublikowana osoba",
    "opublikowane osoby",
    "opublikowanych osób",
  ),
);

function onGo() {
  trackGoal("cta:task", { task: "oswiadczenia", from: "osoba" });
}

// Counted when the ask is scrolled into view, as the home page's is: on mount
// it would only restate the pageview. Watched from when the box is drawn, which
// in the ask's arm is a moment after the page is up, and never in the other.
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
watch(root, (el) => {
  observer?.disconnect();
  observer = null;
  if (!el || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      trackGoal("cta:shown", { surface: "osoba" });
      observer?.disconnect();
    },
    { threshold: 0.6 },
  );
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
.ask-box {
  align-items: center;
  border: 1px dashed rgba(var(--v-border-color), 0.42);
  border-radius: 8px;
  display: flex;
  gap: 16px 24px;
  padding: 16px 20px;
}

.ask-box__words {
  flex: 1 1 auto;
  min-width: 0;
}

.ask-box__title {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.5rem;
  margin: 0 0 2px;
  text-wrap: balance;
}

.ask-box__body {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.25rem;
  margin: 0;
  text-wrap: pretty;
}

.ask-box__go {
  flex: none;
}

/* The figure leads: a column of its own, ruled off from the words. */
.ask-figure {
  border-right: 1px solid rgba(var(--v-border-color), 0.12);
  display: flex;
  flex: none;
  flex-direction: column;
  padding-right: 24px;
  width: 168px;
}

.ask-figure__value {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 2.25rem;
}

.ask-figure__label {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  line-height: 1rem;
  text-wrap: balance;
}

/* A phone: the figure and its label on one line, then the words, then the
   button across the box. */
@media (max-width: 599.98px) {
  .ask-box {
    align-items: stretch;
    flex-direction: column;
    padding: 16px;
  }

  .ask-figure {
    align-items: baseline;
    border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
    border-right: 0;
    flex-direction: row;
    gap: 12px;
    padding: 0 0 12px;
    width: auto;
  }

  .ask-box__go {
    width: 100%;
  }
}
</style>

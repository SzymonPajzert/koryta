<template>
  <div
    v-if="failed"
    class="k-note k-absent d-flex align-center ga-2"
    data-testid="person-successions-error"
  >
    <!-- The quiet line of what a section lacks (`k-absent`), as on a
         company's page, with the alert icon that tells a failure from an
         absence. Flush with the page: the 8px indent it had was a leftover
         of the card the sections used to sit in. -->
    <v-icon :icon="mdiAlertCircleOutline" size="15" />
    <span>Nie udało się wczytać zmian na stanowiskach. Odśwież stronę.</span>
  </div>

  <!-- Nothing to show but something withheld: no section, one quiet line
       under the history it is about - a heading over a sentence that says
       there is nothing under it is a section of nothing. `mt-3` because it
       belongs to the block above rather than starting one of its own
       (`k-sections`, assets/css/edges.css). -->
  <p
    v-else-if="!changes.length && hidden"
    class="k-note k-absent mt-3"
    data-testid="person-successions-note"
  >
    <!-- Not „Brak znanych zmian”: the register does know them, the page just
         does not name the other person. The count and its (i) wrap as one,
         so the icon never starts a line on its own. -->
    Zmiany na stanowiskach:
    <span class="k-absent__tail">
      {{ hiddenCount }}
      <!-- Why none are shown first, then what the section covers: with no
           pairs on the page, the section's „Skąd te pary.” has nothing to
           point at. -->
      <InfoBubble label="Zmiany na stanowisku">
        <span class="d-block" data-testid="person-successions-hidden">
          {{ hiddenSentence }}
        </span>
        <span class="d-block mt-2" data-testid="person-successions-coverage">
          {{ coverage }}
        </span>
      </InfoBubble>
    </span>
  </p>

  <!-- Nothing found and nothing withheld: no heading either. A section that
       announces itself over empty space reads as a page that failed to load,
       and on most people this is what the register supports. -->
  <PageSection
    v-else-if="changes.length"
    title="Zmiany na stanowisku"
    :caption="caption"
    caption-testid="person-successions-count"
    data-testid="person-successions"
  >
    <!-- What the section covers and why it is shorter than the register,
         behind the heading's (i): the count beside the heading says how much
         there is, and the five lines of method that stood here pushed the
         first card off a phone's screen. Said, not dropped - 896 of 6,592
         people in the register have a page, so for a logged out reader the
         withheld changes are often most of what was found. -->
    <template #info>
      <span class="d-block">
        <span class="font-weight-semibold">Skąd te pary.</span>{{ " " }}
        <span data-testid="person-successions-coverage">{{ coverage }}</span>
      </span>
      <span v-if="hidden" class="d-block mt-2">
        <span class="font-weight-semibold">Pominięte zmiany.</span>{{ " " }}
        <span data-testid="person-successions-hidden">
          {{ hiddenSentence }}
        </span>
      </span>
    </template>

    <!-- Each card is the handover row a company's page draws too
         (`HandoverRow`), under this page's own head: the company and the
         role, which are what tell one of a person's cards from the next. -->
    <article
      v-for="change in changes"
      :key="change.key"
      class="k-card k-card--accent succ"
      :data-testid="change.testid"
    >
      <div class="succ__head">
        <v-icon
          :icon="mdiOfficeBuildingOutline"
          size="15"
          class="succ__head-icon"
        />
        <NuxtLink :to="change.companyUrl" class="link-plain succ__company">
          {{ change.companyName }}
        </NuxtLink>
        <!-- The comma is for a reader of the text, which ran the company
             into the role - "ŁÓDŹRada Nadzorcza". Hidden, because this head
             is a line of text rather than a flex row, so a space would show. -->
        <span class="succ__role"
          ><span class="visually-hidden">, </span>{{ change.role }}</span
        >
      </div>

      <SuccessionHandoverRow
        class="succ__row"
        :left="change.left"
        :right="change.right"
        :gap-days="change.gapDays"
      />

      <!-- A whole board changed that day, so the card names one of the
           people who left rather than the one this person followed - which
           is not something the register records. Under the row, where a
           sentence has the card's width: it stood in the gap's narrow
           column, two or three words to a line. -->
      <p
        v-if="change.batchNote"
        class="succ__hedge"
        data-testid="succession-batch-note"
      >
        {{ change.batchNote }}
      </p>
    </article>
  </PageSection>
</template>

<script lang="ts" setup>
import { mdiAlertCircleOutline, mdiOfficeBuildingOutline } from "@mdi/js";
import { nominativeNoun } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import { batchNote, type HandoverSide } from "~/composables/successions";
import type { PersonSuccession } from "~~/server/api/edges/successions.get";

const props = defineProps<{
  personId: string;
  personName: string;
  /** This person's own party chips, for their side of a handover. The endpoint
   * names the parties of the *other* side only, because that is the half the
   * page does not already hold. */
  personParties?: string[];
  /** How many relations the history above this section lists, so the coverage
   * line can say "2 z 8" rather than "2". Left out where the caller does not
   * know, and then the line says how many were matched and no more. */
  relationCount?: number;
}>();

/** What a role nobody recorded is called. The pairing drops spells with no
 * role, so this should never be reached - it is here so that a hand-made edge
 * cannot print an empty gap where the seat should be. */
const NO_ROLE = "funkcja niepodana w rejestrze";

// Shared with the "Wcześniej: …" line on each row of the relation history
// above, which reads the same response under the same key - so the two are one
// request. See `usePersonSuccessions`.
const { data, status } = usePersonSuccessions(props.personId);

const failed = computed(() => status.value === "error");
const posts = computed<PersonSuccession[]>(() => data.value?.posts ?? []);
const hidden = computed(() => data.value?.hidden ?? 0);

/* ---------- the cards ---------- */

/** One handover, read from this person's side.
 *
 * `left` is whoever left the seat and `right` whoever took it, whichever of
 * the two this person is - so the row reads the way the seat moved, with the
 * labels („Ustępuje”, „Obejmuje stanowisko”) on the sides rather than on the
 * people, and none of it has to be conditional in the template.
 */
type Change = {
  key: string;
  testid: string;
  companyName: string;
  companyUrl: string;
  role: string;
  gapDays: number;
  left: HandoverSide;
  right: HandoverSide;
  /** Set when a whole board changed on this day, so which of the departing
   * members this person actually followed is not something the register says.
   * The card names one of them and admits as much. */
  batchNote: string | null;
};

const changes = computed<Change[]>(() =>
  posts.value.flatMap((post, index) => {
    const neighbour = post.predecessor ?? post.successor;
    if (!neighbour) return [];

    // Both sides carry their whole spell now, the other person's too: the
    // endpoint has always sent both of its ends, and the card used to print
    // one of them.
    const other: HandoverSide = {
      name: neighbour.personName,
      parties: neighbour.parties,
      url: generateEntityUrl(
        "person",
        neighbour.personId,
        neighbour.personName,
      ),
      start: neighbour.start,
      end: neighbour.end,
    };
    // This person, with no link: they are who the page is about.
    const mine: HandoverSide = {
      name: props.personName,
      parties: props.personParties ?? [],
      start: post.start,
      end: post.end,
    };

    return [
      {
        batchNote: post.batchSize > 1 ? batchNote(post.batchSize) : null,
        // The edge on the other side is what makes a card unique: this person
        // can hold two spells of one seat, and the index alone would reorder
        // the cards under a refetch.
        key: `${neighbour.edgeId}-${index}`,
        testid: post.predecessor
          ? "succession-predecessor"
          : "succession-successor",
        companyName: post.companyName,
        companyUrl: generateEntityUrl(
          "place",
          post.companyId,
          post.companyName,
        ),
        role: post.role.trim() || NO_ROLE,
        gapDays: neighbour.gapDays,
        left: post.predecessor ? other : mine,
        right: post.predecessor ? mine : other,
      },
    ];
  }),
);

/** Handovers are counted per seat, not per card: a post this person both took
 * over and handed on is one relation in the history above and would otherwise
 * be counted twice against it. */
const matched = computed(
  () =>
    new Set(
      posts.value.map(
        (post) => `${post.companyId}|${post.role}|${post.start}|${post.end}`,
      ),
    ).size,
);

/** What the section covers, in the reader's terms rather than ours.
 *
 * The second sentence is the one that matters: a handover is an inference from
 * two filings, so a seat with no card is far more often a seat whose other
 * half the register never recorded than a seat that was newly created. */
const coverage = computed(() => {
  const total = props.relationCount;
  const of =
    total === undefined
      ? ""
      : `\u00a0- ${matched.value} z ${total} ${total === 1 ? "powiązania" : "powiązań"}`;
  return (
    `Stanowiska, przy których rejestr wskazuje poprzednika lub następcę${of}. ` +
    "Brak wpisu nie znaczy, że stanowisko było nowe: częściej w rejestrze " +
    "brakuje drugiej strony zmiany."
  );
});

/** „2 zmiany · 3 pominięte”: the cards below, and the handovers withheld.
 * Read only while the section is drawn, which is once there are cards. */
const caption = computed(() => {
  const shown = changes.value.length;
  const parts = [
    `${shown} ${nominativeNoun(shown, "zmiana", "zmiany", "zmian")}`,
  ];
  if (hidden.value) parts.push(hiddenCount.value);
  return parts.join(" · ");
});

/** „3 pominięte”, agreeing with „zmiana”. */
const hiddenCount = computed(
  () =>
    `${hidden.value} ${nominativeNoun(hidden.value, "pominięta", "pominięte", "pominiętych")}`,
);

/** Why the section is shorter than the register. */
const hiddenSentence = computed(
  () =>
    `Nie pokazujemy jeszcze ${hidden.value} ` +
    `${hidden.value === 1 ? "zmiany" : "zmian"}\u00a0- brakuje strony jednej ` +
    "z osób, więc nie nazywamy jej tutaj.",
);
</script>

<style scoped>
/* The card, the heading and the lead are global (`app.vue`) - a section draws
   its own chrome but its entries are somebody else's component, so a scoped
   rule cannot reach them and every component that tried ended up with a
   slightly different card. What is left here is this section's own idiom. */

/* Nothing shown but something withheld is the global quiet line
   (`k-absent`, assets/css/type.css), the same one a company's page gives
   what it lacks. */

/* ---- one handover ---- */

/* The insets and the 12px between cards of a company's handover rows: 16px
   clear of the sage rail and of the far edge, so the row the two pages share
   sits the same in both. */
.succ {
  margin-bottom: 12px;
  padding: 12px 16px 12px 20px;
}

.succ__head {
  line-height: 1.4;
}

.succ__head-icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
  margin-right: 5px;
  vertical-align: baseline;
}

.succ__company {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-ui-size);
  font-weight: 700;
}

.visually-hidden {
  border: 0;
  clip: rect(0, 0, 0, 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.succ__role {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  margin-left: 6px;
}

/* The row's own layout, the gap's chip and the party flag are the shared
   row's (`succession/HandoverRow.vue`); the card only spaces it from its
   head. */
.succ__row {
  margin-top: 10px;
}

/* Deliberately plain: it is a caveat, not a warning, and a coloured box round
   it would make the commonest case on the site look like an error. Prose, so
   14px rather than meta's 12 (type.css), at a reading measure. */
.succ__hedge {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  line-height: 1.45;
  margin: 8px 0 0;
  max-width: 72ch;
}
</style>

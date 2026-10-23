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

      <div class="succ__flow">
        <div class="succ__side">
          <div class="succ__label">{{ change.from.label }}</div>
          <div class="succ__name">
            <NuxtLink
              v-if="change.from.url"
              :to="change.from.url"
              class="link-plain"
            >
              {{ change.from.name }}
            </NuxtLink>
            <span v-else>{{ change.from.name }}</span>
            <PartyChip
              v-for="party in change.from.parties"
              :key="party"
              :party
            />
          </div>
          <div class="succ__when">{{ change.from.when }}</div>
        </div>

        <div class="succ__mid">
          <v-icon :icon="mdiArrowRight" size="18" class="succ__arrow" />
          <span class="succ__gap" :class="gapClass(change.gapDays)">
            {{ gapLabel(change.gapDays) }}
          </span>
          <!-- A whole board changed that day, so the card names one of the
               people who left rather than the one this person followed - which
               is not something the register records. -->
          <span
            v-if="change.batchNote"
            class="succ__hedge"
            data-testid="succession-batch-note"
          >
            {{ change.batchNote }}
          </span>
        </div>

        <div class="succ__side">
          <div class="succ__label">{{ change.to.label }}</div>
          <div class="succ__name">
            <NuxtLink
              v-if="change.to.url"
              :to="change.to.url"
              class="link-plain"
            >
              {{ change.to.name }}
            </NuxtLink>
            <span v-else>{{ change.to.name }}</span>
            <PartyChip v-for="party in change.to.parties" :key="party" :party />
          </div>
          <div class="succ__when">{{ change.to.when }}</div>
        </div>
      </div>
    </article>
  </PageSection>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import { nominativeNoun } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import { gapLabel } from "~~/shared/succession";
import { shortDate } from "~~/shared/dates";
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

type SideView = {
  /** Invariant, so no sentence here has to know anybody's gender: the label
   * names the position in the handover, never what the person did. */
  label: string;
  name: string;
  parties: string[];
  /** Absent for this person: a link back to the page the reader is on. */
  url?: string;
  when: string;
};

/** This person's own spell, as the side of a handover they are on. */
function selfSide(post: PersonSuccession, label: string): SideView {
  return {
    label,
    name: props.personName,
    parties: props.personParties ?? [],
    when: selfTerm(post),
  };
}

function selfTerm(post: PersonSuccession): string {
  if (post.start && post.end) {
    return `kadencja ${shortDate(post.start)} - ${shortDate(post.end)}`;
  }
  if (post.start) return `kadencja od ${shortDate(post.start)} · nadal trwa`;
  if (post.end) return `kadencja do ${shortDate(post.end)}`;
  return "brak dat kadencji";
}

/** One handover, read from this person's side.
 *
 * `from` is whoever left the seat and `to` whoever took it, whichever of the
 * two this person is - so the arrow between them always points the way the
 * seat moved, and the labels never have to be conditional in the template.
 */
type Change = {
  key: string;
  testid: string;
  companyName: string;
  companyUrl: string;
  role: string;
  gapDays: number;
  from: SideView;
  to: SideView;
  /** Set when a whole board changed on this day, so which of the departing
   * members this person actually followed is not something the register says.
   * The card names one of them and admits as much. */
  batchNote: string | null;
};

const changes = computed<Change[]>(() =>
  posts.value.flatMap((post, index) => {
    const neighbour = post.predecessor ?? post.successor;
    if (!neighbour) return [];

    const other: SideView = {
      label: post.predecessor
        ? "Wcześniej na tym stanowisku"
        : "Następnie na tym stanowisku",
      name: neighbour.personName,
      parties: neighbour.parties,
      url: generateEntityUrl(
        "person",
        neighbour.personId,
        neighbour.personName,
      ),
      when: post.predecessor
        ? neighbour.end
          ? `kadencja do ${shortDate(neighbour.end)}`
          : "koniec kadencji nieznany"
        : neighbour.start
          ? `kadencja od ${shortDate(neighbour.start)}`
          : "początek kadencji nieznany",
    };
    const mine = selfSide(post, "Ta osoba");

    return [
      {
        // The edge on the other side is what makes a card unique: this person
        // can hold two spells of one seat, and the index alone would reorder
        // the cards under a refetch.
        batchNote:
          post.batchSize > 1
            ? `Tego dnia zmieniło się ${post.batchSize} stanowisk tej samej ` +
              "funkcji - rejestr nie wskazuje, kto zajął czyje miejsce."
            : null,
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
        from: post.predecessor ? other : mine,
        to: post.predecessor ? mine : other,
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

/** Three different facts, not one number with a sign - so the pill that says
 * "tego samego dnia" and the one that says the two filings overlap cannot be
 * mistaken for each other. */
function gapClass(gapDays: number): string {
  if (gapDays === 0) return "succ__gap--same";
  return gapDays < 0 ? "succ__gap--overlap" : "";
}
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

.succ {
  margin-bottom: 8px;
  padding: 11px 12px 12px 14px;
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

.succ__flow {
  align-items: stretch;
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.succ__side {
  flex: 1 1 0;
  min-width: 0;
}

/* A label: what the name under it is. 12/600, quiet, sentence case. */
.succ__label {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.4;
}

.succ__name {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: flex;
  flex-wrap: wrap;
  font-size: 1rem;
  font-weight: 700;
  gap: 5px;
  letter-spacing: -0.01em;
  line-height: 1.35;
  margin-top: 2px;
}

.succ__when {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  margin-top: 3px;
}

.succ__mid {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  max-width: 15ch;
}

.succ__arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* Deliberately plain: it is a caveat, not a warning, and a coloured box round
   it would make the commonest case on the site look like an error. */
.succ__hedge {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.35;
  max-width: 22ch;
  text-align: center;
}

/* The gap between the two holders: a pill in the control tint and radius,
   as on the „Wcześniej:” line of the history above. */
.succ__gap {
  background: var(--k-tonal);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: var(--k-meta-size);
  line-height: 1.5;
  padding: 1px 6px;
  text-align: center;
}

/* The common case, and the one worth seeing from across the page: the register
   recorded the handover as a handover. */
.succ__gap--same {
  background: rgba(var(--v-theme-primary), 0.38);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
  white-space: nowrap;
}

/* Two filings that disagree, which is worth saying out loud rather than
   rendering as a negative number of days. */
.succ__gap--overlap {
  background: rgba(var(--v-theme-secondary), 0.75);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}

/* ---- phone: the two sides stack and the arrow turns with them ---- */
@media (max-width: 600px) {
  .succ__flow {
    flex-direction: column;
    gap: 6px;
  }

  .succ__mid {
    align-items: center;
    flex-direction: row;
    gap: 8px;
    justify-content: flex-start;
    max-width: none;
    padding-left: 2px;
  }

  .succ__arrow {
    transform: rotate(90deg);
  }
}
</style>

<template>
  <div
    v-if="part === 'current' && loading"
    class="text-center py-8"
    data-testid="successions-loading"
  >
    <!-- One of three parts of the company page, picked by `part`, all off
         the page's one request. A part with nothing to show renders nothing
         at all - no heading over a note that the heading is empty - and what
         it would have said goes into the `absent` part's one line.

         The comments go inside the branches, not between them: in a dev
         build a comment there joins the next branch as a fragment, and the
         class the page passes in never reaches the element. -->
    <v-progress-circular indeterminate />
  </div>

  <div
    v-else-if="part === 'current' && failed"
    class="k-note k-absent d-flex align-center ga-2"
    data-testid="successions-error"
  >
    <!-- The quiet line of what a section lacks (`k-absent`), with the alert
         icon that tells a failure from an absence: two sentences of prose,
         at the UI size rather than the 12px of meta. -->
    <v-icon :icon="mdiAlertCircleOutline" size="15" />
    <span>Nie udało się wczytać zmian kadrowych. Odśwież stronę.</span>
  </div>

  <p
    v-else-if="part === 'absent' && ready && absentLine"
    class="k-note k-absent"
    data-testid="company-absent"
  >
    <!-- What the page does not have, in one quiet line after the people -
         the same line a person's page gives what it withholds - and the
         sentences that used to stand in each empty section behind its (i):
         hidden, not deleted. The page sets it 12px under the history, as
         a person's sits under theirs. -->
    {{ absentHead }}
    <!-- The last word and the (i) as one unbreakable piece. -->
    <span class="k-absent__tail"
      >{{ absentTail }}
      <InfoBubble label="Czego tu brakuje">
        <span
          v-for="item in absentInfo"
          :key="item.testid"
          class="d-block why"
          :data-testid="item.testid"
        >
          <strong>{{ item.title }}.</strong> {{ nbsp(item.text) }}
        </span>
      </InfoBubble></span
    >
  </p>

  <PageSection
    v-else-if="part === 'current' && ready && currentGroups.length"
    title="Obecny skład"
    data-testid="successions-current"
  >
    <!-- ============ obecny skład ============ -->
    <!-- `data-nosnippet`: Google opened a company's search result on this
         caption, which says nothing about the company. -->
    <template #caption>
      <span data-nosnippet
        >wpisy bez daty zakończenia, stan na {{ longDate(today) }}</span
      >
    </template>
    <!-- The site's section head, as over every section of an entity page:
         8px over its first group, and the date the board is read at as its
         caption, which on a phone takes a line of its own. -->
    <div
      v-for="group in currentGroups"
      :key="group.key"
      class="k-group"
      :data-testid="`current-role-${group.key}`"
    >
      <!-- The type system's group head, with how many hold the post:
           „Zarząd 3”. -->
      <h3 class="k-group-head board-head">
        {{ group.role }}
        <span class="k-group-head__count">{{ group.people.length }}</span>
      </h3>

      <v-row dense>
        <v-col
          v-for="seat in group.people"
          :key="seat.post.edgeId"
          cols="12"
          md="6"
        >
          <!-- The only place on the page today's board is listed: the
               history below leaves these posts out (Szymon, 2026-10-23), so
               the card carries what their rows there had - the draft badge,
               and the sources, the correction and the bin for whoever may
               use them - and fixing a post stays one click. -->
          <div
            class="k-card k-card--accent pa-4 pl-5 h-100"
            :data-testid="`current-post-${seat.post.edgeId}`"
          >
            <div
              class="board-card"
              :class="{ 'board-card--tools': !!seat.tools }"
            >
              <SuccessionInitials
                class="board-card__avatar"
                :name="seat.post.personName"
                tone="in"
              />
              <div class="board-card__text">
                <div class="d-flex align-center flex-wrap ga-2">
                  <NuxtLink
                    :to="personUrl(seat.post)"
                    class="link-plain text-subtitle-1 font-weight-bold"
                    >{{ seat.post.personName }}</NuxtLink
                  >
                  <PartyChip
                    v-for="party in seat.post.parties"
                    :key="party"
                    :party
                  />
                </div>

                <div class="d-flex align-center flex-wrap ga-2 mt-2">
                  <!-- The day as every row on the site gives it, „od
                       14.05.2026”: the card said „od 14 maja 2026” a few
                       hundred pixels above the history's „od 14.05.2026” for
                       the same post. -->
                  <span class="now-pill">
                    <v-icon :icon="mdiCalendarBlankOutline" size="13" />
                    {{ seat.since }}
                  </span>
                  <!-- The leading spaces in this card are for a reader of
                       the text rather than of the layout: Google's snippet
                       ran the date into the tenure, and the predecessor's
                       name into „wcześniej na tym stanowisku:”. Each sits at
                       the start of a flex item, where it is never drawn. -->
                  <span
                    v-if="seat.tenure"
                    class="text-caption text-medium-emphasis"
                  >
                    {{ ` ${seat.tenure}` }} na stanowisku
                  </span>
                  <!-- Whether the relation is live, as on its history row:
                       among what the post is, not among the buttons. -->
                  <ChipEdgeDraftStatus
                    v-if="seat.edge"
                    :edge-id="seat.edge.id"
                    :published="seat.edge.visibility"
                    :publishable="
                      edgeIsPublishable(seat.edge, subjectPublished)
                    "
                    @published="emit('published')"
                  />
                </div>

                <div
                  v-if="seat.predecessor"
                  class="text-caption text-medium-emphasis mt-2 d-flex align-center flex-wrap ga-1"
                >
                  <v-icon :icon="mdiSwapVertical" size="14" />
                  <span>wcześniej na tym stanowisku:</span>
                  <!-- „m.in.”, the name and its parties as one piece of the
                       line: it moves to a line of its own whole, and breaks
                       inside only where it is wider than the card. A phone
                       broke the line before the chip, which stood alone on
                       the next one, cut off from the name it belongs to. -->
                  <span
                    class="board-card__who d-inline-flex align-center flex-wrap ga-1"
                  >
                    <span
                      v-if="seat.predecessor.batchSize > 1"
                      :title="batchNote(seat.predecessor.batchSize)"
                      >{{ " m.in." }}</span
                    >
                    <NuxtLink
                      :to="personUrl(seat.predecessor)"
                      class="link-plain font-weight-medium"
                      >{{ ` ${seat.predecessor.personName}` }}</NuxtLink
                    >
                    <PartyChip
                      v-for="party in seat.predecessor.parties"
                      :key="party"
                      :party
                    />
                  </span>
                </div>
              </div>

              <CardHistoryRowActions
                v-if="seat.tools"
                class="board-card__tools"
                :edge="seat.tools"
                :can-cite
                :can-correct
                :can-remove
                @sources="emit('sources', $event)"
                @edit="emit('edit', $event)"
                @remove="emit('remove', $event)"
              />
            </div>
          </div>
        </v-col>
      </v-row>
    </div>
  </PageSection>

  <PageSection
    v-else-if="part === 'relay' && ready && successions.length"
    title="Kto kogo zastąpił"
    :caption="relayCaption"
    caption-testid="successions-count"
    data-testid="successions-relay"
  >
    <!-- ============ kto kogo zastąpił ============ -->
    <!-- The count beside the head says how many it leaves out, so four
         handovers out of sixty never read as the whole register. How the
         pairs are made, and what is left out, behind the (i): the method
         was four lines of 12px prose between the heading and the first
         card. -->
    <template #info>
      <span
        v-for="item in relayInfo"
        :key="item.testid"
        class="d-block why"
        :data-testid="item.testid"
      >
        <strong>{{ item.title }}.</strong> {{ nbsp(item.text) }}
      </span>
    </template>

    <div
      v-for="section in roleSections"
      :key="section.key"
      class="k-group"
      :data-testid="`succession-role-${section.key}`"
    >
      <!-- With how many handovers the post saw: „Prezes zarządu 4”. No rule
           under it, unlike a board's head: the handovers below are boxes,
           and a line over a box's edge is two lines. -->
      <h3 class="k-group-head">
        {{ section.role }}
        <span class="k-group-head__count">{{ section.count }}</span>
      </h3>

      <div :id="listId(section.key)" class="relay-list">
        <!-- Focusable only where „Pokaż starsze” sends the focus: the first
             card it opens. -->
        <div
          v-for="(batch, index) in shownBatches(section)"
          :id="batchId(section.key, index)"
          :key="batch.key"
          class="k-card k-card--accent relay-batch"
          :class="{ 'ev--batch': batch.pairs.length > 1 }"
          :tabindex="index === section.foldAt ? -1 : undefined"
          data-testid="succession-batch"
        >
          <!-- The company's head for a handover: the day the seat changed
               hands, and on a day a whole board did, how many seats and
               whose parties left. -->
          <div class="ev-head">
            <span class="ev-date">{{
              batch.date ? longDate(batch.date) : "Bez daty w rejestrze"
            }}</span>
            <span
              v-if="batch.pairs.length > 1"
              class="ev-badge"
              data-testid="batch-count"
            >
              <!-- „tego dnia”, not „tego samego dnia”: the gap chip in a row
                   already says that for a seat taken the day it was left
                   (Szymon, 2026-10-24). -->
              <!-- The leading space keeps the count off the date for a
                   reader of the text. -->
              {{
                ` ${polishCounting(batch.pairs.length, "zmiana", "zmiany", "zmian")}`
              }}
              tego dnia
            </span>
            <span
              v-if="batch.pairs.length > 1 && batch.tally.length"
              class="ev-sub"
              data-testid="batch-parties"
            >
              wśród ustępujących: {{ batch.tally.join(", ") }}
            </span>
          </div>

          <!-- The row a person's page draws too (`HandoverRow`), with the
               labels in each side at every width: they stood once over the
               columns, outside the card, on a computer, and in each row on
               a phone. -->
          <SuccessionHandoverRow
            v-for="pair in batch.pairs"
            :key="`${pair.left.edgeId}-${pair.joined.edgeId}`"
            class="ev-row"
            :left="sideOf(pair.left)"
            :right="sideOf(pair.joined)"
            :gap-days="pair.gapDays"
            data-testid="succession-row"
          />
        </div>
      </div>

      <!-- The rest of a long relay one click away, opened in place, and the
           button gone once it has: the bio's „Pokaż więcej”
           (EntityDetailsCard.vue). Never in the way of an edit - nothing
           here is a row anybody corrects. A neutral text button, its label
           on the cards' left edge (`ms-n2` hangs its padding into the
           gutter) and 44px tall, so a finger finds it: at rest a text
           button has no box to look taller. -->
      <v-btn
        v-if="section.older && !opened.has(section.key)"
        variant="text"
        height="44"
        class="px-2 ms-n2"
        :append-icon="mdiChevronDown"
        aria-expanded="false"
        :aria-controls="listId(section.key)"
        :data-testid="`succession-older-${section.key}`"
        @click="openOlder(section)"
      >
        Pokaż starsze ({{ section.older }})
      </v-btn>
    </div>
  </PageSection>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiCalendarBlankOutline,
  mdiChevronDown,
  mdiSwapVertical,
} from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import { createSlug, generateEntityUrl } from "~/composables/slugs";
import { edgeIsPublishable, type EdgeNode } from "~/composables/edges";
import {
  batchNote,
  useSuccessionToday,
  type HandoverSide,
} from "~/composables/successions";
import { ledgerPeriod, spellLength } from "~/utils/relationPeriod";
import { MAX_GAP_DAYS, MAX_OVERLAP_DAYS } from "~~/shared/succession";
import { longDate } from "~~/shared/dates";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "~~/server/api/edges/successions.get";
import type { AsyncDataRequestStatus } from "#app";

const props = defineProps<{
  companyName: string;
  /** Which part of the company page this instance draws. The page renders
   * the component three times, around its relation history: `current` (who
   * holds a post now, and the spinner or the error while there is no
   * answer), `absent` (one line on what the register does not tell us), and
   * `relay` (who took over from whom). */
  part: "current" | "absent" | "relay";
  /** The answer of `/api/edges/successions` for this company, and the state
   * of the request, from `useCompanySuccessions`: the page asks once and
   * hands the answer to all three parts. */
  data: CompanySuccessions | null | undefined;
  status: AsyncDataRequestStatus;
  /** The page's relations, which a card of the current board finds its post
   * in by edge id. Only `current` reads this and the four props after it: a
   * card whose post is here gets that relation's draft badge and the
   * history's row tools (`CardHistoryRowActions`), with the same permissions
   * the history is given; a card with no match gets neither. */
  edges?: EdgeNode[];
  canCite?: boolean;
  canCorrect?: boolean;
  canRemove?: boolean;
  /** Whether the company's own page is live - see the same prop on
   * `CardEmploymentHistory`. */
  subjectPublished?: boolean;
}>();

/** What a card's tools ask for, passed up to the page's own dialogs: the same
 * events, and the same handlers, as the history's rows. */
const emit = defineEmits<{
  sources: [edge: EdgeNode];
  edit: [edge: EdgeNode];
  remove: [edge: EdgeNode];
  /** A card's relation went live from its draft badge. */
  published: [];
}>();

/** The roles a reader looks for first, in the order they look: who runs the
 * company, who stands in for them, the rest of the board, then whoever
 * supervises it. Everything else - prokurent, likwidator, a dyrektor biura
 * somebody typed by hand - sorts alphabetically after them. Matched on the
 * lowercased name, the way `shared/succession.ts` matches a seat.
 *
 * The prezes and the deputies used to be in that alphabetical tail, so PKP's
 * current board read Zarząd, dyrektor…, naczelnik…, prezes, zastępca prezesa -
 * „Kolejność osób - prezes, zastępca prezesa, potem zarząd” is the report.
 * They are matched by how the title starts, because the register says
 * „Prezes Zarządu" where somebody adding a relation by hand says „prezes", and
 * both are the same seat - up to a space or the end of the title, so that
 * „prezes" does not also take a „prezesa…" of some other kind.
 *
 * Two entries for the supervisory organ: it reaches this card under whichever
 * name the institution's own form gives it (`displayRole`, applied by
 * `/api/edges/successions`), and a hospital's rada społeczna belongs in the
 * same place a spółka's rada nadzorcza does. No company has both. */
const ROLE_ORDER: RegExp[] = [
  /^prezes( |$)/,
  /^(wiceprezes|zastępca prezesa)( |$)/,
  /^(zarząd|członek zarządu)$/,
  /^rada nadzorcza$/,
  /^rada społeczna$/,
];

/** What a role with no name is called on screen. The pairing drops spells
 * whose role nobody recorded, so this only ever labels a current post. The
 * endpoint leaves out a role-less copy of a prokura that also arrived as
 * „Prokurent" (see `withoutRedundantRoleless`), which used to put one person
 * under both headings; a role-less post beside a zarząd seat is a different
 * post, and keeps this label. */
const NO_ROLE = "Funkcja niepodana w rejestrze";

/** How many handovers each function shows before „Pokaż starsze”: the newest
 * five (Szymon, 2026-10-23). PKP LHS has 63, about 14,000px of a phone, more
 * than the rest of its page together. A day the whole board changed is never
 * split, so a function can open on more than five where the fifth falls inside
 * one. */
const RELAY_SHOWN = 5;

const failed = computed(() => props.status === "error");
const loading = computed(() => !failed.value && !props.data);

const successions = computed<Succession[]>(() => props.data?.successions ?? []);
const current = computed<CurrentPost[]>(() => props.data?.current ?? []);
const hidden = computed(() => props.data?.hidden ?? 0);
const nothingToShow = computed(
  () => !successions.value.length && !current.value.length && !hidden.value,
);
/** An answer to draw from. Every part but `current` stays silent until then:
 * the spinner and the error are said once, where the people will be. */
const ready = computed(() => !loading.value && !failed.value);

/** The day the board is read at and every spell is measured to, shared with
 * the handover rows - see `useSuccessionToday`. */
const today = useSuccessionToday();

/* ---------- people ---------- */

function personUrl(who: { personId: string; personName: string }): string {
  return generateEntityUrl("person", who.personId, who.personName);
}

/** One side of a handover as the shared row takes it. */
function sideOf(side: SuccessionSide): HandoverSide {
  return {
    name: side.personName,
    url: personUrl(side),
    parties: side.parties,
    start: side.start,
    end: side.end,
  };
}

/* ---------- grouping ---------- */

function roleKey(role: string | null): string {
  return role?.trim().toLowerCase() ?? "";
}

/** A function's name as a group head. The register gives some in lower case -
 * „dyrektorka działu obsługi spółki” stood under „Zarząd” and „Rada
 * Nadzorcza” as it came - and a head reads in sentence case. The first letter
 * only, so an acronym further on keeps its capitals. */
function headCase(role: string): string {
  return role.charAt(0).toLocaleUpperCase("pl") + role.slice(1);
}

function roleRank(key: string): number {
  const at = ROLE_ORDER.findIndex((pattern) => pattern.test(key));
  return at < 0 ? ROLE_ORDER.length : at;
}

/** Prezes, the deputies, Zarząd, Rada Nadzorcza, then whatever else the
 * register holds, in Polish collation. */
function byRole<T>(groups: Map<string, { role: string; items: T[] }>) {
  return [...groups.entries()]
    .sort(
      ([a, ga], [b, gb]) =>
        roleRank(a) - roleRank(b) || ga.role.localeCompare(gb.role, "pl"),
    )
    .map(([key, group]) => ({
      // Slugged rather than raw: a `data-testid` carrying a space and an ę is
      // a selector every test has to quote.
      key: createSlug(key) || "bez-funkcji",
      role: group.role,
      items: group.items,
    }));
}

/** The page's relations by edge id, for the cards' tools. */
const edgeById = computed(
  () =>
    new Map(
      (props.edges ?? []).flatMap((edge) =>
        edge.id ? [[edge.id, edge] as const] : [],
      ),
    ),
);

/** Whether a card draws any of the row tools - the conditions
 * `CardHistoryRowActions` draws its buttons on, as the history checks them. */
function hasTools(edge: EdgeNode): boolean {
  return (
    !!edge.id &&
    ((edge.references?.length ?? 0) > 0 ||
      !!props.canCite ||
      !!props.canCorrect ||
      !!props.canRemove)
  );
}

/** Open posts by role, longest-serving first. A post with no start date sorts
 * last rather than reading as the oldest one there.
 *
 * Each one carries whoever the handover put out of that seat, matched on the
 * arriving edge: it is the same fact as a row of the relay below, said where a
 * reader looking at today's board is standing. And the relation it is, from
 * the page's own list, for the badge and the tools.
 */
const currentGroups = computed(() => {
  // Carrying the batch with the person: a seat that changed hands on a day when
  // three others did is one the register cannot say who took from whom, and the
  // line below has to hedge rather than name somebody flatly.
  const predecessors = new Map(
    successions.value.map((s) => [
      s.joined.edgeId,
      { ...s.left, batchSize: s.batchSize },
    ]),
  );
  const groups = new Map<string, { role: string; items: CurrentPost[] }>();
  for (const post of current.value) {
    const key = roleKey(post.role);
    const group = groups.get(key);
    if (group) group.items.push(post);
    else {
      groups.set(key, {
        role: headCase(post.role?.trim() || NO_ROLE),
        items: [post],
      });
    }
  }
  return byRole(groups).map((group) => ({
    ...group,
    people: group.items
      .sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"))
      .map((post) => {
        const edge = edgeById.value.get(post.edgeId) ?? null;
        return {
          post,
          predecessor: predecessors.get(post.edgeId) ?? null,
          edge,
          tools: edge && hasTools(edge) ? edge : null,
          since:
            ledgerPeriod(post.start ?? undefined, undefined, {
              today: today.value,
            })?.text ?? "bez daty powołania",
          tenure: spellLength(post.start, null, today.value),
        };
      }),
  }));
});

type Batch = {
  key: string;
  date: string | null;
  pairs: Succession[];
  /** "3 × PiS", the parties among the people leaving on this day. */
  tally: string[];
};

type RoleSection = {
  key: string;
  role: string;
  count: number;
  batches: Batch[];
  /** How many batches are shown before „Pokaż starsze”, and how many
   * handovers that leaves behind it - none for a function short enough to
   * show whole. */
  foldAt: number;
  older: number;
};

/** Where a function's relay folds: after the batch that brings it to
 * `RELAY_SHOWN` handovers, so a day's batch is shown whole or not at all. */
function foldAt(batches: Batch[]): number {
  let shown = 0;
  let at = 0;
  while (at < batches.length && shown < RELAY_SHOWN) {
    shown += batches[at]!.pairs.length;
    at += 1;
  }
  return at;
}

/** The relay: role, then handover date.
 *
 * The date grouping is the point. The register files a board turnover as one
 * decision - seven struck off and seven entered on one morning - and seven
 * separate cards would tell a reader it happened seven times. A handover with
 * no date is left on its own: those share nothing but the gap in the data, and
 * a „4 zmiany tego dnia” badge over them would be a claim about a day
 * nobody recorded.
 */
const roleSections = computed<RoleSection[]>(() => {
  const groups = new Map<string, { role: string; items: Succession[] }>();
  for (const succession of successions.value) {
    const key = roleKey(succession.role);
    const group = groups.get(key);
    if (group) group.items.push(succession);
    else
      groups.set(key, {
        role: headCase(succession.role.trim() || NO_ROLE),
        items: [succession],
      });
  }

  return byRole(groups).map((group) => {
    const ordered = [...group.items].sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") ||
        a.joined.edgeId.localeCompare(b.joined.edgeId),
    );

    const batches: Batch[] = [];
    for (const succession of ordered) {
      const last = batches[batches.length - 1];
      if (last && succession.date && last.date === succession.date) {
        last.pairs.push(succession);
      } else {
        batches.push({
          key: `${succession.date ?? "brak"}-${succession.joined.edgeId}`,
          date: succession.date,
          pairs: [succession],
          tally: [],
        });
      }
    }

    for (const batch of batches) {
      const tally = new Map<string, number>();
      for (const pair of batch.pairs) {
        for (const party of pair.left.parties) {
          tally.set(party, (tally.get(party) ?? 0) + 1);
        }
      }
      batch.tally = [...tally.entries()]
        .sort(([pa, na], [pb, nb]) => nb - na || pa.localeCompare(pb, "pl"))
        .map(([party, n]) => `${n} × ${party}`);
    }

    const fold = foldAt(batches);
    return {
      key: group.key,
      role: group.role,
      count: ordered.length,
      batches,
      foldAt: fold,
      older: batches
        .slice(fold)
        .reduce((sum, batch) => sum + batch.pairs.length, 0),
    };
  });
});

/** The functions whose older handovers the reader has opened. */
const opened = ref(new Set<string>());

function shownBatches(section: RoleSection): Batch[] {
  return opened.value.has(section.key)
    ? section.batches
    : section.batches.slice(0, section.foldAt);
}

/** Ids for the button to point at and the focus to land on, unique per page
 * and the same on the server and in the browser. */
const relayId = useId();

function listId(sectionKey: string): string {
  return `${relayId}-${sectionKey}`;
}

function batchId(sectionKey: string, index: number): string {
  return `${relayId}-${sectionKey}-${index}`;
}

/** Opening the older handovers takes the focused button away, which would
 * drop a keyboard or screen-reader user back to the top of the page. Focus
 * goes to the first card it opened instead, as the bio's „Pokaż więcej” sends
 * it to the bio; `preventScroll`, because the cards open downwards from where
 * the reader already is. */
async function openOlder(section: RoleSection) {
  opened.value.add(section.key);
  await nextTick();
  document
    .getElementById(batchId(section.key, section.foldAt))
    ?.focus({ preventScroll: true });
}

/** „4 zmiany w 2 funkcjach · 5 pominiętych”: the relay's cards, the roles
 * they fall under, and the handovers left out. */
const relayCaption = computed(() => {
  const shown =
    `${polishCounting(successions.value.length, "zmiana", "zmiany", "zmian")} ` +
    `w ${polishCounting(roleSections.value.length, "funkcji", "funkcjach", "funkcjach")}`;
  return hidden.value
    ? `${shown} · ${polishCounting(hidden.value, "pominięta", "pominięte", "pominiętych")}`
    : shown;
});

/* ---------- what the page does not have ---------- */

/** One paragraph of a bubble: what it is about, the sentence, and the hook a
 * test finds it by - the testid the sentence carried when it stood in the
 * page's flow. */
type Why = { title: string; text: string; testid: string };

/** Each sentence that used to stand in an empty section, word for word. */
const sentences = computed(() => ({
  empty:
    `Nie mamy wpisów kadencyjnych dla: ${props.companyName}. Kiedy rejestr ` +
    "poda daty powołania i odwołania, pojawi się tu obecny skład i to, kto " +
    "kogo zastąpił.",
  // Two reasons, and the page cannot tell them apart: the endpoint drops a
  // post whose holder has no page without counting it, the way the rest of
  // the site does.
  currentEmpty:
    "Nie mamy tu nikogo z otwartym wpisem: albo każdy wpis, który znamy, ma " +
    "już datę zakończenia, albo brakuje strony osoby, która zajmuje " +
    "stanowisko.",
  none:
    "Nie dopasowaliśmy tu żadnej zmiany: wpisy, które znamy, nie mają dat, " +
    `albo nikt nie objął stanowiska w oknie ${MAX_GAP_DAYS} dni od jego ` +
    "zwolnienia.",
  // Why the handovers are fewer than the register's. Said, because two of
  // fifteen with no word on the rest reads as a bug.
  hidden:
    `Nie pokazujemy ${polishCounting(hidden.value, "zmiany", "zmian", "zmian")}\u00a0- ` +
    "brakuje strony jednej z osób. W zestawieniu są tylko te zmiany, w " +
    "których obie osoby mają u nas swoją stronę.",
  method:
    "Pary dobrane 1:1 w obrębie tej spółki i tej samej funkcji: koniec " +
    "jednego wpisu i początek kolejnego w oknie od " +
    `${MAX_OVERLAP_DAYS} dni przed do ${MAX_GAP_DAYS} dni po. Wpisy z tego ` +
    "samego dnia zebrano w jedno zdarzenie.",
}));

/** What stands behind the relay's (i) when the relay is drawn. */
const relayInfo = computed<Why[]>(() => [
  ...(hidden.value
    ? [
        {
          title: "Pominięte zmiany",
          text: sentences.value.hidden,
          testid: "successions-hidden",
        },
      ]
    : []),
  {
    title: "Jak dobieramy pary",
    text: sentences.value.method,
    testid: "relay-method",
  },
]);

/** The one line under the people: which of the two sections is missing, and
 * how many handovers were left out when that is why the relay is. Nothing
 * when both are on the page. */
const absentLine = computed(() => {
  const noCurrent = !currentGroups.value.length;
  const noRelay = !successions.value.length;
  const skipped = hidden.value;
  if (noCurrent && noRelay && !skipped) {
    return "Nie znamy obecnego składu ani zmian na stanowiskach.";
  }
  const parts: string[] = [];
  if (noCurrent) parts.push("Nie znamy obecnego składu.");
  if (noRelay && !skipped) parts.push("Nie znamy zmian na stanowiskach.");
  if (noRelay && skipped) {
    const where = skipped === 1 ? "stanowisku" : "stanowiskach";
    parts.push(
      `Pominęliśmy ${polishCounting(skipped, "zmianę", "zmiany", "zmian")} na ${where}, ` +
        "bo brakuje strony jednej z osób.",
    );
  }
  // No one-letter word at the end of a line: „…jednej z / osób.” is the
  // phone's break otherwise.
  return nbsp(parts.join(" "));
});

/** The line up to its last word, and the last word, which the template keeps
 * on one line with the (i) after it. */
const absentHead = computed(() =>
  absentLine.value.slice(0, absentLine.value.lastIndexOf(" ") + 1),
);
const absentTail = computed(() =>
  absentLine.value.slice(absentLine.value.lastIndexOf(" ") + 1),
);

/** Behind the line's (i): the sentence each missing section used to print,
 * and - when the relay is the one missing - what it leaves out and how its
 * pairs are made, which would otherwise sit behind the relay's own (i). */
const absentInfo = computed<Why[]>(() => {
  if (nothingToShow.value) {
    return [
      {
        title: "Obecny skład i zmiany",
        text: sentences.value.empty,
        testid: "successions-empty",
      },
    ];
  }
  const items: Why[] = [];
  if (!currentGroups.value.length) {
    items.push({
      title: "Obecny skład",
      text: sentences.value.currentEmpty,
      testid: "current-empty",
    });
  }
  if (!successions.value.length) {
    items.push({
      title: "Kto kogo zastąpił",
      text: sentences.value.none,
      testid: "successions-none",
    });
    items.push(...relayInfo.value);
  }
  return items;
});
</script>

<style scoped>
/* `k-card`, `k-card--accent` and `k-note` are global (`app.vue`), and the
   section heads are the site's `PageSection`. They used to be here too, at
   values a little off the ones `succession/PersonChanges.vue` carried - 8px
   round instead of 10, a 4px full-height rail instead of a 3px inset one, a
   baseline-aligned heading instead of a centred one, and a head 16px over
   its content where every other section's stands 8. Nobody chose that; they
   were copied at different times. The company page moves to the shared
   values, which is what lets the notes underneath these cards be the same
   object as the cards themselves. The group heads (`k-group-head`,
   assets/css/type.css) and the line on what the page lacks (`k-absent`) are
   the shared ones too, the same as on a person's page - and so, since
   2026-10-23, is the handover row (`succession/HandoverRow.vue`). */

/* A bubble that says more than one thing: a gap between its paragraphs. */
.why + .why {
  margin-top: 6px;
}

/* Over a board's cards, and only there, a hairline under the group head:
   the cards stand apart in a grid, and without the line three of them read
   as three loose boxes rather than one board. A list that is one box of its
   own - the history, the handovers below - needs no line over its edge. */
.board-head {
  border-bottom: 1px solid var(--k-line);
  padding-bottom: 6px;
}

/* ---- obecny skład ---- */

/* Who, then what the post is; with an editor's tools for it at the card's
   edge, on the name's line, where the history's rows keep theirs. On the
   name's line rather than centred: cards of one row are as tall as the
   tallest, so tools centred on each card's own text zigzagged across the
   row. Only a card with tools has their column, or its empty gap would
   still cost the text 12px. */
.board-card {
  align-items: start;
  column-gap: 12px;
  display: grid;
  grid-template-areas: "avatar text";
  grid-template-columns: auto minmax(0, 1fr);
}

.board-card--tools {
  grid-template-areas: "avatar text tools";
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.board-card__avatar {
  grid-area: avatar;
}

.board-card__text {
  grid-area: text;
  min-width: 0;
}

.board-card__tools {
  align-self: start;
  grid-area: tools;
}

/* Free to shrink below its widest word, so a name with six party chips that
   is wider than the card breaks inside the group rather than past its edge. */
.board-card__who {
  min-width: 0;
}

/* Sage behind ink rather than as ink: the one thing a reader scanning the
   section is looking for is who is in the seat now. */
.now-pill {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: inline-flex;
  font-size: var(--k-meta-size);
  font-weight: 600;
  gap: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}

/* ---- the relay ---- */

/* The cards of one function 12px apart, and nothing under the last: the next
   function's head stands the type system's 24px below it (`k-group`). */
.relay-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Focus only lands here from „Pokaż starsze”, as a reading position, not a
   control: a ring round the whole card would frame it like something to
   press. */
.relay-batch:focus {
  outline: none;
}

.ev-head {
  align-items: center;
  border-bottom: 1px solid var(--k-line);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 16px 10px 20px;
}

/* One sage strip over a batch: the rows below it are one decision. */
.ev--batch .ev-head {
  background: rgba(var(--v-theme-primary), 0.22);
}

.ev-date {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-ui-size);
  font-weight: 700;
}

.ev-badge {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: var(--k-r-pill);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-meta-size);
  font-weight: 700;
  padding: 1px 9px;
  white-space: nowrap;
}

.ev-sub {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: var(--k-meta-size);
  margin-left: auto;
}

/* One handover of the batch, inset 16px clear of the sage rail and of the
   far edge, as on a person's card, with the hairline between the rows. */
.ev-row {
  padding: 12px 16px 12px 20px;
}

.ev-row + .ev-row {
  border-top: 1px solid var(--k-line);
}

/* ---- phone ---- */
@media (max-width: 599.98px) {
  /* An editor's tools take the card's last line, at its right edge, where
     the history's rows put theirs on a phone: beside the name they would
     leave it about 110px. */
  .board-card--tools {
    grid-template-areas:
      "avatar text"
      ". tools";
    grid-template-columns: auto minmax(0, 1fr);
  }

  .board-card__tools {
    justify-self: end;
    margin-top: 8px;
  }

  /* Tapped here, so the count of sources is as tall as the pencil and the
     bin beside it, as on the history's rows on a phone. It is the tools'
     only button with a label. */
  .board-card__tools :deep(.v-btn:not(.v-btn--icon)) {
    --v-btn-height: 40px;
  }

  .ev-sub {
    margin-left: 0;
    width: 100%;
  }
}
</style>

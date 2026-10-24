<template>
  <!-- Nothing at all when there is nothing to list and no way to add one:
       after the de-duplication fix a company whose only relations were its own
       still drew the heading over an empty list. An editor keeps it, because
       „Dodaj" lives in it. Same guard ConnectionList has carried all along.

       The head is the site's section head (`PageSection`), as over every
       other section of an entity page, and outside the list: an h2 among
       the rows of a `role="list"` was a heading inside a list. On a
       company's page its caption says how many people the list holds and
       how far back it goes, as „Obecny skład” carries its date. -->
  <PageSection
    v-if="edges.length > 0 || canAdd"
    title="Historia powiązań"
    :caption="companyCaption"
    caption-testid="history-caption"
    data-testid="relations-history"
  >
    <!-- The control tint rather than `variant="text" color="primary"`:
         sage ink on white is 1.85:1 on this theme, and this is the one
         control in the section. -->
    <template v-if="canAdd" #actions>
      <v-btn
        variant="tonal"
        size="small"
        :prepend-icon="mdiPlus"
        data-testid="add-relation-employment"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </template>

    <v-list
      class="pa-0"
      :class="{ 'history-list--bleed': bleed }"
      variant="flat"
    >
      <!-- One ruled box, the rows divided by the hairline, rather than a
           stack of boxes; edge to edge on a phone. On a person's or a
           company's page (`ledger`) one box per group, each under its quiet
           head: the people a person knows, what is held today, what ended,
           and what has no dates. -->
      <!-- One element per group, not a fragment: signed in, the list can
           hold a group the server's anonymous render did not (a draft under
           „Osoby”), and a keyed list of fragments that disagrees with the
           server's left the server's copy of the list in the page under the
           new one. Elements are replaced and the leftovers removed. -->
      <div
        v-for="group in groups"
        :key="group.key"
        class="k-group"
        :data-testid="`history-box-${group.key}`"
      >
        <!-- An h3: the groups split one long list into parts a screen
             reader can jump between, under the section's h2. -->
        <h3
          v-if="group.title"
          class="k-group-head"
          :data-testid="`history-group-${group.key}`"
        >
          {{ group.title }}
          <span class="k-group-head__count">{{ group.edges.length }}</span>
        </h3>
        <div class="history-box" :class="{ 'k-bleed-xs': bleed }">
          <v-list-item
            v-for="edge in group.edges"
            :key="edge.id"
            :to="rowLink(edge)"
            :target="newTab ? '_blank' : undefined"
            class="history-row"
            :class="{
              'history-row--ledger': ledger,
              'history-row--ended': ledger && group.key === 'ended',
              'history-row--barred': ledger && !!ledgerOf(edge),
              'history-row--acts': ledger && showsActions(edge),
            }"
          >
            <template #prepend>
              <v-icon :icon="entityIcon(edge.richNode.type)" />
            </template>

            <!-- The row's text in one box: a plain block everywhere, and on a
                 ledger a grid that sets the name across the whole row, then the
                 role line with the bar and its dates at its right end, then the
                 „Wcześniej:” rail, with the buttons at the row's edge
                 (`history-row--ledger`, below). -->
            <div
              class="history-cell"
              :class="{
                'history-cell--dated': ledger && !!ledgerOf(edge),
                'history-cell--acts':
                  ledger && (hasActions(edge) || reserveSources),
                'history-cell--rail': ledger && predecessorOf(edge).length > 0,
              }"
            >
              <!-- `title` because the phone clamps this to two lines: a
                   registry name runs to sixty characters and the ellipsis has
                   to leave the full one somewhere. -->
              <v-list-item-title
                class="history-cell__title text-subtitle-2 font-weight-bold text-wrap"
                :title="edge.richNode.name"
              >
                {{ edge.richNode.name }}
              </v-list-item-title>

              <div
                class="history-cell__meta d-flex align-center flex-wrap ga-2"
              >
                <!-- The role is prose, not meta: 14px, the UI size. -->
                <span class="text-body-2 text-medium-emphasis text-wrap">
                  {{ edgeLabel(edge) }}
                </span>
                <!-- What the candidacy was for. The ingest names every one of
                     them „kandydatura", so a run for the Senate and one for a
                     gmina council read alike without it. Bold, as `ShortNode`
                     prints it: it is the word on the row that says which kind
                     of election this was. -->
                <span
                  v-if="officeOf(edge)"
                  class="text-caption font-weight-bold"
                  :data-testid="`edge-office-${edge.id}`"
                >
                  {{ officeOf(edge) }}
                </span>
                <!-- Whose party the person at the other end is in. Never
                     collides with the candidacy chip below: that one only shows
                     on `election` rows, whose far end is a place. -->
                <PartyChip
                  v-for="party in partiesOf(edge)"
                  :key="party"
                  :party
                />
                <PartyChip v-if="partyOf(edge)" :party="partyOf(edge)!" />
                <span
                  v-if="committeeOf(edge)"
                  class="history-meta__committee text-caption text-medium-emphasis text-wrap"
                >
                  {{ committeeOf(edge) }}
                </span>
                <v-chip
                  v-if="wonSeat(edge)"
                  size="x-small"
                  color="success"
                  variant="flat"
                  :data-testid="`edge-elected-${edge.id}`"
                >
                  Wybrany
                </v-chip>
                <!-- On a person's page only as the exception: nearly every row
                     there is a public company, which is what the page is about,
                     and fifteen identical sage chips said nothing per row. -->
                <ChipPublicCompany
                  v-if="!ledger || !edgeCompany(edge)?.isPublic"
                  :company="edgeCompany(edge)"
                />
                <!-- Which sector the employer belongs to, so a career reads as
                     the shape it has - three railways and a water utility -
                     rather than four registry names the reader has to recognise
                     one by one. Draws nothing where the row is not a company,
                     or where nobody has filed one under a sector. -->
                <ChipCompanyCategories :company="edgeCompany(edge)" />
                <!-- A candidacy in a second place of the same election:
                     somebody else's, one of the two. Before the draft badge,
                     whose „Opublikuj" is what would put it live. -->
                <ChipPlaceClash :edge :clash="clashOf.get(edge)" />
                <!-- Whether the relation itself is live. Among the chips rather
                     than among the buttons on the right: it says what the row
                     *is*, the way the sector and the party do, and the one
                     control it carries belongs next to the words that explain
                     it. -->
                <ChipEdgeDraftStatus
                  :edge-id="edge.id"
                  :published="edge.visibility"
                  :publishable="isPublishable(edge)"
                  @published="emit('published')"
                />
                <!-- Last, where the bar sits on a wide screen. On a phone the
                     bar is a 200px track in a 210px column, clipped at both
                     ends, and the dates it captions are the only part of it
                     that survives the width - so below md the row prints them
                     and drops the track. The leading space is for a reader of
                     the text, where the row read "ZarządPO2026-08-28"; at the
                     start of a flex item it is never drawn. -->
                <!-- „obecnie” in bold: a post held today reads stronger than
                     one that ended in 2008. -->
                <span
                  v-if="!ledger && isDated(edge)"
                  class="d-md-none text-caption text-medium-emphasis"
                >
                  {{ ` ${periodOf(edge).start}`
                  }}<template v-if="periodOf(edge).end !== undefined">
                    -
                    <strong v-if="periodOf(edge).current">{{
                      periodOf(edge).end
                    }}</strong>
                    <template v-else>{{ periodOf(edge).end }}</template>
                  </template>
                </span>
              </div>

              <!-- On a ledger: the bar on one time scale for the whole
                   list and its dates beside it at the UI size, at the right
                   end of the role line, so the name keeps the row's width and
                   the dates line up down the box; on a phone the dates take a
                   line of their own, with the row's buttons, and the bar runs
                   under them at the row's full width. The dates were a 12px
                   caption under a dark 200px track, which a phone clipped at
                   both ends and dropped. -->
              <template v-if="ledger && ledgerOf(edge)">
                <span
                  class="history-period history-cell__period"
                  :class="{
                    'history-period--current': ledgerOf(edge)!.current,
                  }"
                  :title="ledgerOf(edge)!.text"
                  :data-testid="`edge-period-${edge.id}`"
                >
                  <span class="history-period__full">{{
                    ledgerOf(edge)!.text
                  }}</span>
                  <!-- The phone's short form of the same dates: out of
                       search snippets, which read every period twice. -->
                  <span class="history-period__years" data-nosnippet>{{
                    ledgerOf(edge)!.years
                  }}</span>
                </span>
              </template>

              <!-- Who sat here before. A `v-for` over nought or one so the
                   lookup is read once per row rather than four times, and only
                   the predecessor: the section below the card carries both
                   directions, and this row already holds a company, a role, a
                   chip, a bar and two dates. -->
              <div
                v-for="predecessor in predecessorOf(edge)"
                :key="predecessor.edgeId"
                class="history-row__rail history-cell__rail"
                :data-testid="`edge-predecessor-${edge.id}`"
              >
                <v-icon
                  :icon="mdiArrowUp"
                  size="13"
                  class="history-row__rail-icon"
                  aria-hidden="true"
                />
                <span class="history-row__rail-label">Wcześniej:</span>
                <!-- „m.in." where a whole board changed on one day. The
                     register struck four names off and entered four, and which
                     of them took whose chair is an assignment the pairing made
                     up; naming one of them flatly would assert something nobody
                     recorded. -->
                <span
                  v-if="predecessor.batchSize > 1"
                  class="history-row__rail-label"
                  :title="batchNote(predecessor.batchSize)"
                >
                  m.in.
                </span>
                <!-- Text, not a link. The row itself is an anchor to the other
                     end of the relation, and an anchor inside an anchor is
                     invalid HTML - the parser closes the outer one and reopens
                     it around each fragment, which split this row into three
                     boxes. Clicking through to the predecessor is what „Zmiany
                     na stanowisku" below is for. -->
                <!-- Leading spaces, as in the dates above: the rail is a
                     flex row, so they are never drawn, but a snippet reads it
                     as text. -->
                <span class="history-row__rail-name">
                  {{ ` ${predecessor.personName}` }}
                </span>
                <PartyChip
                  v-for="party in predecessor.parties"
                  :key="party"
                  :party
                />
                <span class="history-row__rail-gap">
                  {{ ` ${gapLabel(predecessor.gapDays)}` }}
                </span>
              </div>

              <!-- The bar and the row's buttons, as one foot: on a wide screen
                   it steps aside (`display: contents`) and the grid sets the
                   bar on the role line and the buttons at the row's edge; on a
                   phone it is the row's last line, the bar filling what the
                   buttons leave. Sharing the dates' column, the buttons had
                   squeezed the role line to 181px. -->
              <div
                v-if="ledger && (ledgerOf(edge) || showsActions(edge))"
                class="history-cell__foot"
              >
                <ChipRelativeDuration
                  v-if="ledgerOf(edge)"
                  bare
                  class="history-cell__bar"
                  :start="edge.start_date"
                  :end="edge.end_date"
                  :min-start="minStart"
                  :max-end="maxEnd"
                />
                <CardHistoryRowActions
                  v-if="showsActions(edge)"
                  class="history-cell__actions"
                  :edge
                  :can-cite
                  :can-correct
                  :can-remove
                  :reserve-sources="reserveSources"
                  @sources="emit('sources', $event)"
                  @edit="emit('edit', $event)"
                  @remove="emit('remove', $event)"
                />
              </div>
            </div>

            <template v-if="!ledger" #append>
              <div class="d-flex align-center ga-2">
                <!-- `data-nosnippet`: the bar captions the same two dates the
                     row prints below `md`, and the page's text carries both,
                     so a search result read every period twice. -->
                <div
                  v-if="isDated(edge)"
                  class="d-none d-md-flex"
                  data-nosnippet
                >
                  <ChipRelativeDuration
                    :start="edge.start_date"
                    :end="edge.end_date"
                    :min-start="minStart"
                    :max-end="maxEnd"
                  />
                </div>
                <CardHistoryRowActions
                  v-if="hasActions(edge)"
                  :edge
                  :can-cite
                  :can-correct
                  :can-remove
                  @sources="emit('sources', $event)"
                  @edit="emit('edit', $event)"
                  @remove="emit('remove', $event)"
                />
              </div>
            </template>
          </v-list-item>
        </div>
      </div>
    </v-list>
  </PageSection>
</template>

<script lang="ts" setup>
import { mdiArrowUp, mdiPlus } from "@mdi/js";
// Imported rather than left to Nuxt's auto-import, as PageSection imports
// InfoBubble: this card's own tests mount it with a plain `mount`, which has
// no auto-import resolver, and an unresolved component renders as nothing -
// for PageSection, the whole card.
import CardHistoryRowActions from "./HistoryRowActions.vue";
import PageSection from "../PageSection.vue";
import { entityIcon } from "~/utils/entityIcon";
import {
  historySpanCaption,
  ledgerPeriod,
  relationPeriodParts,
} from "~/utils/relationPeriod";
import { batchNote } from "~/composables/successions";
import { gapLabel } from "~~/shared/succession";
import { displayRole } from "~~/shared/companyBodies";
import { asArray, type Company } from "~~/shared/model";
import { withoutRedundantRoleless } from "~~/shared/rolelessSpells";
import { placeClashes, type PlaceClash } from "~~/shared/twoPlaces";
import type { PersonSuccession } from "~~/server/api/edges/successions.get";
import { nodeLinkUrl } from "~/composables/slugs";

/** Whoever held a seat before the spell an edge records, as the successions
 * endpoint names them, plus how many seats changed hands that day. */
type Predecessor = NonNullable<PersonSuccession["predecessor"]> & {
  batchSize: number;
};

const props = defineProps<{
  edges: EdgeNode[];
  /** Whether this section offers adding a relation. */
  canAdd?: boolean;
  /** Whether each row offers citing the relation to an article. A reader who
   * cannot cite still sees the count on the relations that have one. Separate
   * from `canCorrect` because not every host mounts the sources dialog - the
   * drawer does not - and a button that emits into nothing is worse than no
   * button. */
  canCite?: boolean;
  /** Whether each row offers correcting what the relation says. Open to anyone
   * signed in: `/api/edges/update` files a contributor's version as a proposal
   * rather than applying it. */
  canCorrect?: boolean;
  /** Whether each row offers taking the relation off the graph outright, which
   * is an administrator's decision and nobody else's. */
  canRemove?: boolean;
  /** Whether the page these relations hang off is itself published. Decides
   * whether an unpublished row offers an admin the way to publish it - a
   * relation to a draft page cannot go live, and the draft's own „Opublikuj"
   * dialog carries its relations along anyway. Left undefined where the surface
   * does not know; see `edgeIsPublishable`. */
  subjectPublished?: boolean;
  /** The institution this list belongs to, on the page that *is* one.
   *
   * A person's page has a different company on every row and reads it off the
   * row itself; a company's page has one, and its rows hold the people. Only
   * the second case needs telling, which is why this is optional - see
   * `roleOwner`. */
  company?: Company;
  /** On a company's page, the whole history the caption counts when the card
   * is handed fewer rows than that: the posts „Obecny skład” draws as cards
   * are left out of the rows (Szymon, 2026-10-23), and the caption still
   * counts them. Unset, the caption counts the rows it lists. */
  captionEdges?: EdgeNode[];
  /** Who held each seat before, keyed by the edge id of the spell that took it
   * over. Optional because most callers of this card do not ask
   * `/api/edges/successions` at all - and because the successions of a company
   * page's rows are somebody else's, not this person's.
   *
   * The endpoint answers per post rather than per edge, so a caller builds this
   * with `predecessorsByEdge` (app/utils/succession.ts) rather than by hand. */
  predecessors?: Record<string, Predecessor>;
  /** Whether a row opens the page at its far end in a tab of its own rather
   * than in place of this one. For a host whose place is worth keeping: the
   * note queue, whose „Cofnij" only reaches the verdicts given since the page
   * was opened. The router's own navigation stands aside for `_blank`, so the
   * browser opens the tab. */
  newTab?: boolean;
  /** Whether a row whose far end nobody has published is drawn without a
   * link. Off by default, which is right for everybody who can open drafts.
   * The logged out teaser of an unpublished person turns it on: there the
   * company at the far end may be a draft too, and a link to it would only be
   * a second wall. (On rather than off as the special case because an absent
   * boolean prop is `false`.) */
  unlinkDrafts?: boolean;
  /** Whether the box runs edge to edge on a phone, through the layout's
   * gutter. For a page that lists it at its full width - a person's, a
   * company's - and not for a drawer or a card that pads it differently. */
  bleed?: boolean;
  /** An entity's own page reads the list as a ledger: grouped into „Osoby”,
   * „Obecnie”, „Zakończone” and „Bez dat”, the bar and its period in two
   * columns of their own in one date format, and the posts that ended a step
   * quieter than the ones held today. A person's page and a company's pass
   * it; every other host - the drawer, /eksploruj/nowe, the queues - keeps
   * the one list. */
  ledger?: boolean;
  /** Whether a ledger files the rows that lead to a person by their period,
   * like every other row, rather than first in an „Osoby” group of their
   * own. For a company's page, where every row leads to a person - the
   * people who held its posts - and „Osoby” would be the whole list in one
   * box, with nothing held today told from what ended. A person's page
   * leaves it off: there the people are the acquaintances, who have no
   * period, and are what the site is about. */
  peopleByPeriod?: boolean;
}>();

const emit = defineEmits<{
  add: [];
  sources: [edge: EdgeNode];
  edit: [edge: EdgeNode];
  remove: [edge: EdgeNode];
  /** A row went live. The badge hides itself, so a caller that draws the same
   * relation only here need not listen; the ones that also draw it in a graph
   * refetch on this. */
  published: [];
}>();

/** Where a row leads: the page at its far end, unless that page is a draft
 * this list was asked not to link to. */
function rowLink(edge: EdgeNode): string | undefined {
  if (props.unlinkDrafts && edge.richNode.visibility === false) {
    return undefined;
  }
  return nodeLinkUrl(edge.richNode);
}

/** Whether the row's „Opublikuj" is offered, for this list's subject. */
function isPublishable(edge: EdgeNode): boolean {
  return edgeIsPublishable(edge, props.subjectPublished);
}

/** How many articles a relation is cited to. An edge that predates
 * `references`, or one the graph returned without it, counts as none rather
 * than breaking the row. */
function sourceCount(edge: EdgeNode) {
  return edge.references?.length ?? 0;
}

/** Whether a row draws any of `CardHistoryRowActions`' buttons - the same
 * conditions the buttons are drawn on. */
function hasActions(edge: EdgeNode): boolean {
  return (
    !!edge.id &&
    (sourceCount(edge) > 0 ||
      !!props.canCite ||
      !!props.canCorrect ||
      !!props.canRemove)
  );
}

/** Whether a ledger row draws the buttons' column: where it has buttons, and
 * on a dated row where another row's sources button would otherwise push the
 * dates out of line (`reserveSources`). */
function showsActions(edge: EdgeNode): boolean {
  return hasActions(edge) || (reserveSources.value && !!ledgerOf(edge));
}

/** Whether a ledger row with nothing cited keeps the sources button's room.
 * Only a reader who cannot cite sees the button on some rows and not on
 * others, and there a missing one moved that row's dates 58px to the right
 * of its neighbours'. */
const reserveSources = computed(
  () =>
    !!props.ledger &&
    !props.canCite &&
    listedEdges.value.some((edge) => !!edge.id && sourceCount(edge) > 0),
);

/** The rows this card lists: every relation it was handed, less the role-less
 * copy of a prokura the same person also holds under its name over the same
 * time. PZO Gliwice listed one of its prokurents as „Prokurent" and again as
 * „Zatrudniony/a w", both from 2026-07-14 - one appointment, stored twice. See
 * `withoutRedundantRoleless`, which is also why a role-less row beside a
 * zarząd seat stays: that one is a different post.
 *
 * Here rather than in each host, so the person's page, the company's,
 * `/eksploruj/nowe` and the drawer cannot disagree about it. The row is only
 * left out of the list; the stored copy is still there, and taking the 35 such
 * copies out of the database is a job for a migration rather than for 35
 * clicks on a bin. */
const listedEdges = computed(() =>
  withoutRedundantRoleless(props.edges, employmentSpell),
);

/** The clash each candidacy row takes part in, where it puts its person in a
 * second place of one election - see shared/twoPlaces.ts. Over every row, the
 * published and the drafts alike: a signed in reader is handed both, and
 * either side may be the one that is not this person's. */
const clashOf = computed(() => {
  const byRow = new Map<EdgeNode, PlaceClash<EdgeNode>>();
  const clashes = placeClashes(listedEdges.value, (edge) =>
    edge.type === "election"
      ? {
          personId: edge.source,
          regionId: edge.target,
          startDate: edge.start_date,
          position: edge.position,
        }
      : undefined,
  );
  for (const clash of clashes) {
    for (const row of clash.rows) byRow.set(row, clash);
  }
  return byRow;
});

/** „4 osoby · wpisy od 2016”, on a company's page only (`historySpanCaption`
 * says how it counts). Over `captionEdges` when the page hands the card fewer
 * rows than the history holds, less the same role-less copies the rows leave
 * out, so the count is the card's own over every row it would have listed. */
const companyCaption = computed(() => {
  if (!props.company) return "";
  return historySpanCaption(
    props.captionEdges
      ? withoutRedundantRoleless(props.captionEdges, employmentSpell)
      : listedEdges.value,
  );
});

const edgesSorted = computed(() => {
  return listedEdges.value.toSorted((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;

    return b.start_date.localeCompare(a.start_date);
  });
});

/** The boxes the rows are drawn in. One, unheaded, everywhere but on a
 * ledger; there, the people a person knows, then what is held today, what
 * ended, and what has no dates - today's sort put the undated posts among
 * the people, above a seat taken last month. On a company's ledger
 * (`peopleByPeriod`) the people are those rows themselves. The sort inside
 * each group is the list's own. */
const groups = computed(() => {
  if (!props.ledger) {
    return [{ key: "all", title: "", edges: edgesSorted.value }];
  }
  const by = {
    current: [] as EdgeNode[],
    ended: [] as EdgeNode[],
    undated: [] as EdgeNode[],
    people: [] as EdgeNode[],
  };
  for (const edge of edgesSorted.value) {
    const period = ledgerOf(edge);
    if (!props.peopleByPeriod && edgePerson(edge)) by.people.push(edge);
    else if (!period) by.undated.push(edge);
    else if (period.current) by.current.push(edge);
    else by.ended.push(edge);
  }
  // The people first: „they are in a sense current as well and the crux of
  // the whole website” (Szymon, 2026-10-16).
  const present = [
    { key: "people", title: "Osoby", edges: by.people },
    { key: "current", title: "Obecnie", edges: by.current },
    { key: "ended", title: "Zakończone", edges: by.ended },
    { key: "undated", title: "Bez dat", edges: by.undated },
  ].filter((group) => group.edges.length > 0);
  // One group is the whole list: „Zakończone 1” over the teaser's one post
  // read as the count of everything the person ever held.
  return present.length > 1
    ? present
    : present.map((group) => ({ ...group, title: "" }));
});

/** The period a ledger row prints - see `ledgerPeriod`. A candidacy prints
 * its year alone: its day is the server's guess at the election, not the
 * register's record. */
function ledgerOf(edge: EdgeNode) {
  return ledgerPeriod(edge.start_date, edge.end_date, {
    yearOnly: edge.type === "election",
  });
}

const minStart = computed(() => {
  return edgesSorted.value
    .map((e) => e.start_date)
    .filter((d): d is string => !!d)
    .toSorted((a, b) => a?.localeCompare(b))[0];
});

const maxEnd = computed(() => {
  return new Date().toISOString().split("T")[0];
});

/** Whose organ decides what a row's role is called.
 *
 * The row holds one end of the relation and the page holds the other, so which
 * of the two is the institution depends on whose page this is. `edgeCompany`
 * answers it for a person's rows; `company` is a company page telling this card
 * about itself, because there the far end is a person and the row alone cannot
 * say. */
function roleOwner(edge: EdgeNode): Company | undefined {
  return edgeCompany(edge) ?? props.company;
}

/** What the row calls the relation.
 *
 * `edge.label` is the edge's own name, which for a supervisory seat is
 * "Rada Nadzorcza" whatever the institution's organ is really called - so a
 * hospital's rada społeczna would read as a supervisory board it does not
 * have. See `displayRole`.
 */
function edgeLabel(edge: EdgeNode) {
  return displayRole(edge.label, roleOwner(edge)) ?? edge.label;
}

/** The office a candidacy was for - "Sejm", "Senat", "Rada gminy", or
 * "Samorząd" for a local election nothing has named the seat of yet (see the
 * `election` entry in server/utils/edges.ts).
 *
 * Guarded on the type for the reason `partyOf` is. */
function officeOf(edge: EdgeNode): string | undefined {
  return edge.type === "election" ? edge.position || undefined : undefined;
}

/** The party a candidacy was run for, on the edges that assert one.
 *
 * Only `election` edges carry it in the schema, but the check is explicit: a
 * hand-made edge of another type that picked up a stray `party` should not
 * start rendering a party chip on somebody's profile.
 */
function partyOf(edge: EdgeNode): string | undefined {
  return edge.type === "election" ? edge.party || undefined : undefined;
}

/** The electoral committee a candidacy was run under.
 *
 * Shown next to the party rather than instead of it: `party` is the national
 * brand a committee was mapped onto, `committee` its full registered name, and
 * for a local committee ("KWW Wspólny Kalisz") there is no party at all. Both
 * are dropped when they say the same thing, which is the case for the committees
 * whose name *is* the party.
 */
function committeeOf(edge: EdgeNode): string | undefined {
  if (edge.type !== "election" || !edge.committee) return undefined;
  const party = partyOf(edge);
  if (party && party.toLowerCase() === edge.committee.toLowerCase()) {
    return undefined;
  }
  return edge.committee;
}

/** Whether PKW recorded this candidacy as winning the mandate.
 *
 * Only a win renders. `elected` is stored as a bare boolean, and `false` is
 * what `useEdgeEdit` writes for every box a contributor left unticked, so it
 * does not mean "lost" - it means nobody said, which is also true of the 70%
 * of PKW's register that publishes no result at all. A "Przegrał" chip built
 * on that would be a claim about a named person drawn from an absence.
 *
 * Guarded on the type for the reason `committeeOf` is: the card lists every
 * relation a person has, and only a candidacy can be won.
 */
function wonSeat(edge: EdgeNode): boolean {
  return edge.type === "election" && edge.elected === true;
}

/** Whether the edge asserts a period at all.
 *
 * The card lists every relation a person has, not only the employment it is
 * named after, and some kinds carry no dates by construction - a `connection`
 * has no date fields in the schema. Drawing a full-width bar for those claims a
 * span nobody recorded, so they get the label and nothing else. */
function isDated(edge: EdgeNode): boolean {
  return !!(edge.start_date || edge.end_date);
}

/** The period a phone prints in place of the bar, in its two ends. */
function periodOf(edge: EdgeNode) {
  return relationPeriodParts(edge.start_date, edge.end_date);
}

/** The parties of the person a row leads to.
 *
 * This list was the last one on the site that named a person without them. A
 * `connection` row on somebody's page said only "Powiązanie z" and a name; on a
 * company's page the same rows are the board, and "Obecny skład" and "Kto kogo
 * zastąpił" directly above them - `succession/CompanyChanges.vue` - chip every
 * name they print, as does the graph below, which colours a node by party.
 *
 * Read off the far end's node, unlike `partyOf` above: this is an affiliation
 * the other person's page asserts, not a claim the relation makes. Through
 * `asArray` because a node written before 2026-07-28 stores its `parties` as
 * `{"0": "PiS"}` rather than as an array - see `asArray`.
 */
function partiesOf(edge: EdgeNode): string[] {
  return asArray<string>(edgePerson(edge)?.parties);
}

/** The predecessor of one row, as nought or one of them.
 *
 * A list so the template can `v-for` it: `v-if` would mean looking the edge up
 * again for every field it prints, each behind a non-null assertion. */
function predecessorOf(edge: EdgeNode): Predecessor[] {
  const predecessor = edge.id ? props.predecessors?.[edge.id] : undefined;
  return predecessor ? [predecessor] : [];
}
</script>

<style scoped>
/* The rows were `base-color="surface-light"`, which paints the whole list a
   low-contrast grey slab, and then a box each, seventeen of them for one
   career. Now one white box on the hairline, a hairline between the rows, and
   sage kept for the hover edge - never for ink, which on this theme is
   1.85:1. */
.history-box {
  border: 1px solid var(--k-line);
  border-radius: var(--k-r-card);
  overflow: hidden;
}

.history-row {
  background: rgb(var(--v-theme-surface));
  border-radius: 0;
  transition: box-shadow 0.2s ease;
}

.history-row + .history-row {
  border-top: 1px solid var(--k-line);
}

/* Today's sage hover edge, drawn inside the row so the rules between rows
   stay where they are. Only for a pointer that hovers: on a phone a tap left
   it lit. */
@media (hover: hover) {
  .history-row:hover {
    box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.9);
  }
}

/* Vuetify's own hover overlay on a near-white surface is a grey wash that
   fights the border above. */
.history-row :deep(.v-list-item__overlay) {
  display: none;
}

/* ---- a ledger: groups and the period columns ----

   The groups' heads and the gap between them are the type system's group
   head (`k-group-head` and `k-group`, assets/css/type.css). */

/* A post that ended reads a step quieter than one held today: the name at
   500 rather than 700, in the .78 ink. */
.history-row--ended :deep(.v-list-item-title) {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-weight: 500 !important;
}

/* The row's text as a grid on a ledger: the name across the row; the
   role line with the bar and its dates at its right end, in fixed columns so
   the dates line up down the box; the „Wcześniej:” rail under them; the
   buttons at the row's edge, centred on it. Everywhere else the cell is a
   plain block. The bar is the brief's 360px where the page is wide and 200px
   between md and lg; the dates' column fits „15.05.2023 - 04.12.2024” at
   14px on one line. */
.history-row--ledger .history-cell {
  align-items: center;
  column-gap: 16px;
  display: grid;
  grid-template-areas:
    "title"
    "meta"
    "rail";
  grid-template-columns: minmax(0, 1fr);
}

.history-row--ledger .history-cell--dated {
  grid-template-areas:
    "title title title"
    "meta bar period"
    "rail rail rail";
  grid-template-columns: minmax(0, 1fr) 360px 172px;
}

/* The buttons' column only where a row has buttons (or holds their room): an
   empty one still keeps its gap. They span the rail's row only where there
   is a rail - spanning an empty row, Chrome gave it 10px of the buttons' 40
   and every signed in row grew by it. */
.history-row--ledger .history-cell--acts {
  grid-template-areas:
    "title actions"
    "meta actions"
    "rail rail";
  grid-template-columns: minmax(0, 1fr) auto;
}

.history-row--ledger .history-cell--acts.history-cell--rail {
  grid-template-areas:
    "title actions"
    "meta actions"
    "rail actions";
}

.history-row--ledger .history-cell--dated.history-cell--acts {
  grid-template-areas:
    "title title title actions"
    "meta bar period actions"
    "rail rail rail rail";
  grid-template-columns: minmax(0, 1fr) 360px 172px auto;
}

.history-row--ledger
  .history-cell--dated.history-cell--acts.history-cell--rail {
  grid-template-areas:
    "title title title actions"
    "meta bar period actions"
    "rail rail rail actions";
}

@media (max-width: 1279.98px) {
  .history-row--ledger .history-cell--dated {
    grid-template-columns: minmax(0, 1fr) 200px 172px;
  }

  .history-row--ledger .history-cell--dated.history-cell--acts {
    grid-template-columns: minmax(0, 1fr) 200px 172px auto;
  }
}

.history-cell__title {
  grid-area: title;
}

.history-cell__meta {
  grid-area: meta;
  min-width: 0;
}

.history-cell__rail {
  grid-area: rail;
}

.history-cell__bar {
  grid-area: bar;
}

.history-cell__period {
  grid-area: period;
}

.history-cell__actions {
  grid-area: actions;
}

.history-row--ledger .history-cell__foot {
  display: contents;
}

/* On the role line's first line, not centred on a role line that wraps - a
   candidacy's committee: the 6px track in the middle of the 20px line. */
.history-row--ledger .history-cell__bar,
.history-row--ledger .history-cell__period {
  align-self: start;
}

.history-row--ledger .history-cell__bar {
  margin-top: 7px;
}

/* A candidacy's committee last on its role line, after the party, the
   „Wybrany” chip and a draft's „Opublikuj”: the committee's long name is
   what wraps, onto a line of its own, rather than pushing the admin's
   button down to a fourth line. */
.history-row--ledger .history-meta__committee {
  order: 1;
}

.history-period {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  line-height: 1.45;
  text-align: right;
  white-space: nowrap;
}

/* The years are the compact form of the dates (`ledgerPeriod`); the full
   dates show everywhere but on a phone's ended posts (below). */
.history-period__years {
  display: none;
}

/* On a phone a post that ended gives its years („2023-2024”) and one held
   today keeps its full day („od 19.08.2026”): the row stays one line of
   role and dates, and the day still shows when the current post began.
   Szymon picked this (C) over full dates everywhere (A) on 2026-10-23. */
@media (max-width: 599.98px) {
  .history-row--ledger
    .history-period:not(.history-period--current)
    .history-period__full {
    display: none;
  }

  .history-row--ledger
    .history-period:not(.history-period--current)
    .history-period__years {
    display: inline;
  }
}

/* Held today: in full ink and 600, the first thing the column says. */
.history-period--current {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}

/* Below md a dated row ends with its dates: they and the buttons on one
   line, the bar under them at the row's full width - after the rail, so the
   bar is always the row's last line and can stand in for the hairline under
   it. An undated row keeps its buttons beside the role, under the name. */
@media (max-width: 959.98px) {
  .history-row--ledger .history-cell--acts,
  .history-row--ledger .history-cell--acts.history-cell--rail {
    grid-template-areas:
      "title title"
      "meta actions"
      "rail rail";
  }

  /* Compact: the dates at the right end of the role line, as on a wide
     screen, and the foot - the bar, and signed in the row's buttons - as the
     row's last line, so the role line keeps the row's width less the dates. */
  .history-row--ledger .history-cell--dated,
  .history-row--ledger .history-cell--dated.history-cell--acts,
  .history-row--ledger
    .history-cell--dated.history-cell--acts.history-cell--rail {
    grid-template-areas:
      "title title"
      "meta period"
      "rail rail"
      "foot foot";
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .history-row--ledger .history-cell__foot {
    align-items: center;
    display: flex;
    gap: 16px;
    grid-area: foot;
    margin-top: 8px;
  }

  /* An undated row's foot holds its buttons alone, beside the role. */
  .history-row--ledger
    .history-cell:not(.history-cell--dated)
    .history-cell__foot {
    grid-area: actions;
    margin-top: 0;
  }

  .history-row--ledger .history-cell__foot .history-cell__bar {
    align-self: center;
    flex: 1 1 auto;
    margin-top: 0;
    min-width: 0;
  }

  /* With the 40px buttons on it the foot carries its own air: no gap above
     it and less padding under it than under a bare bar. */
  .history-row--ledger .history-cell--acts .history-cell__foot {
    margin-top: 2px;
  }

  .history-row--ledger .history-cell__foot .history-cell__actions {
    flex: none;
  }

  /* The sources button is a small one, 28px tall, beside two 40px icon
     buttons; on a phone it is tapped, so it takes their height. */
  .history-cell__actions :deep(.v-btn--size-small:not(.v-btn--icon)) {
    --v-btn-height: 40px;
  }

  .history-row--barred + .history-row {
    border-top: 0;
  }

  .history-row--barred {
    padding-bottom: 14px;
  }

  .history-row--barred.history-row--acts {
    padding-bottom: 6px;
  }
}

/* ---- who sat here before ---- */

/* An annotation on the row rather than a line in it: the rail says this hangs
   off the company and role above, and keeps it out of the way of the duration
   bar underneath. */
.history-row__rail {
  align-items: center;
  border-left: 2px solid rgb(var(--v-theme-primary));
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  flex-wrap: wrap;
  font-size: var(--k-meta-size);
  gap: 4px;
  line-height: 1.45;
  margin-top: 7px;
  padding-left: 9px;
}

.history-row__rail-icon {
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.history-row__rail-label {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
}

.history-row__rail-name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}

/* The gap between two holders of a seat: the same tinted pill as on the
   cards of „Zmiany na stanowisku”, in the control tint and radius. */
.history-row__rail-gap {
  background: var(--k-tonal);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: var(--k-meta-size);
  line-height: 1.5;
  padding: 0 6px;
}

/* ---- on a phone ---- */

/* Five relations used to fill a whole screen, because a 375px row leaves the
   text about 210px and spends every one of them wrapping. The rules here buy
   that width back rather than shrinking the type. */
@media (max-width: 599.98px) {
  /* The box bleeds through the layout's gutter (`k-bleed-xs`), and Vuetify's
     list scrolls its own overflow: left at `auto` it clipped the bleed at the
     column - every row 16px short on both sides - and turned the list into a
     sideways scroller. The list never has a height to scroll within here. */
  .history-list--bleed {
    overflow: visible;
  }

  /* 56px of the row goes on an icon that says „this leads to a company" - which
     the company name below it says already. Kept above sm, where it is the one
     thing telling an employment row from a candidacy at a glance and the width
     is free. Hiding the slot collapses its grid column, spacer and all. */
  .history-row :deep(.v-list-item__prepend) {
    display: none;
  }

  /* Two lines and an ellipsis: a registry name runs to sixty characters, and
     wrapping one costs more of the screen than the rest of the row together.
     The `title` attribute on the element keeps the whole name reachable. */
  .history-row :deep(.v-list-item-title) {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.3;
  }
}
</style>

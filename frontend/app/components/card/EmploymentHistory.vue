<template>
  <v-list class="px-2" variant="flat" data-testid="relations-history">
    <div class="d-flex align-center justify-space-between mb-2">
      <h3 class="text-h6">Historia powiązań</h3>
      <!-- Outlined rather than `variant="text" color="primary"`: sage ink on
           white is 1.85:1 on this theme, and this is the one control in the
           section. -->
      <v-btn
        v-if="canAdd"
        variant="outlined"
        size="small"
        rounded="lg"
        :prepend-icon="mdiPlus"
        data-testid="add-relation-employment"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </div>

    <div class="pa-1">
      <v-list-item
        v-for="edge in edgesSorted"
        :key="edge.id"
        :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
        class="history-row mt-1"
        rounded
      >
        <template #prepend>
          <v-icon :icon="entityIcon(edge.richNode.type)" />
        </template>

        <v-list-item-title class="text-subtitle-2 font-weight-bold text-wrap">
          {{ edge.richNode.name }}
        </v-list-item-title>

        <div class="d-flex align-center flex-wrap ga-2">
          <!-- The period sits *inside* the role span below md, not beside it:
               as a sibling it would be another flex item and wrap onto its own
               line under a role of any length, and the row is being cut, not
               rearranged. Above md the dates stay where they were, under the
               bar in the append column - which is `display: none` here, and
               whose phone stand-in was a 200px bar in a 160px column, clipped
               at both ends by `.v-list-item__content { overflow: hidden }`, so
               it could not say the one thing a bar says. -->
          <span class="text-caption text-medium-emphasis text-wrap"
            >{{ edgeLabel(edge)
            }}<span
              v-if="isDated(edge)"
              class="d-md-none"
              :data-testid="`edge-period-${edge.id}`"
              >&nbsp;· {{ periodLabel(edge.start_date, edge.end_date) }}</span
            ></span
          >
          <PartyChip v-if="partyOf(edge)" :party="partyOf(edge)!" />
          <!-- Ellipsised to one line below md, with the whole of it in the
               title: three lines of a phone row for the registered name of a
               committee, on a row whose subject is the district and the year,
               is the single widest thing on a candidacy.

               `text-wrap` came off because it is `white-space: normal
               !important` and would beat the clamp. It was doing nothing here
               anyway - only `.v-list-item-title` and `.v-list-subheader__text`
               set `nowrap` in VList's stylesheet, and this span is neither. -->
          <span
            v-if="committeeOf(edge)"
            class="text-caption text-medium-emphasis history-row__committee"
            :title="committeeOf(edge)"
          >
            {{ committeeOf(edge) }}
          </span>
          <ChipPublicCompany :company="asCompany(edge)" compact />
        </div>

        <!-- Who sat here before. A `v-for` over nought or one so the lookup is
             read once per row rather than four times, and only the predecessor:
             the section below the card carries both directions, and this row
             already holds a company, a role, a chip, a bar and two dates. -->
        <div
          v-for="predecessor in predecessorOf(edge)"
          :key="predecessor.edgeId"
          class="history-row__rail"
          :data-testid="`edge-predecessor-${edge.id}`"
        >
          <v-icon
            :icon="mdiArrowUp"
            size="13"
            class="history-row__rail-icon"
            aria-hidden="true"
          />
          <span class="history-row__rail-label">Wcześniej:</span>
          <!-- „m.in." where a whole board changed on one day. The register
               struck four names off and entered four, and which of them took
               whose chair is an assignment the pairing made up; naming one of
               them flatly would assert something nobody recorded. -->
          <span
            v-if="predecessor.batchSize > 1"
            class="history-row__rail-label"
            :title="batchNote(predecessor.batchSize)"
          >
            m.in.
          </span>
          <!-- Text, not a link. The row itself is an anchor to the other end of
               the relation, and an anchor inside an anchor is invalid HTML -
               the parser closes the outer one and reopens it around each
               fragment, which split this row into three boxes. Clicking
               through to the predecessor is what „Zmiany na stanowisku" below
               is for. -->
          <span class="history-row__rail-name">
            {{ predecessor.personName }}
          </span>
          <PartyChip v-for="party in predecessor.parties" :key="party" :party />
          <span class="history-row__rail-gap">
            {{ gapLabel(predecessor.gapDays) }}
          </span>
        </div>

        <template #append>
          <div class="d-flex align-center ga-2">
            <div v-if="isDated(edge)" class="d-none d-md-flex">
              <ChipRelativeDuration
                :start="edge.start_date"
                :end="edge.end_date"
                :min-start="minStart"
                :max-end="maxEnd"
              />
            </div>
            <!-- What the claim rests on. The row itself is a link to the other
                 end, so this stops the click rather than letting it navigate
                 away from the relation it is about. -->
            <v-btn
              v-if="edge.id && (sourceCount(edge) > 0 || canEdit)"
              variant="text"
              size="small"
              class="px-1"
              :color="sourceCount(edge) > 0 ? undefined : 'medium-emphasis'"
              :title="
                sourceCount(edge) > 0
                  ? 'Pokaż źródła powiązania'
                  : 'Dodaj źródło powiązania'
              "
              :data-testid="`edge-sources-open-${edge.id}`"
              @click.stop.prevent="emit('sources', edge)"
            >
              <v-icon
                :icon="
                  sourceCount(edge) > 0
                    ? mdiFileDocumentMultipleOutline
                    : mdiFileDocumentPlusOutline
                "
                size="small"
              />
              <span v-if="sourceCount(edge) > 0" class="ml-1 text-caption">
                {{ sourceCount(edge) }}
              </span>
            </v-btn>
            <!-- Admins only, and last in the row: this is the one control here
                 that takes something away. Stops the click for the same reason
                 the sources button does - the row is a link to the other end. -->
            <v-btn
              v-if="edge.id && canRemove"
              variant="text"
              size="small"
              color="error"
              class="px-1"
              title="Usuń powiązanie"
              :icon="mdiTrashCanOutline"
              :data-testid="`edge-remove-${edge.id}`"
              @click.stop.prevent="emit('remove', edge)"
            />
          </div>
        </template>
      </v-list-item>
    </div>
  </v-list>
</template>

<script lang="ts" setup>
import {
  mdiArrowUp,
  mdiFileDocumentMultipleOutline,
  mdiFileDocumentPlusOutline,
  mdiPlus,
  mdiTrashCanOutline,
} from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import { periodLabel } from "~/utils/period";
import { gapLabel } from "~~/shared/succession";
import { displayRole } from "~~/shared/companyBodies";
import type { Company } from "~~/shared/model";
import type { PersonSuccession } from "~~/server/api/edges/successions.get";

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
   * cannot edit still sees the count on the relations that have one. */
  canEdit?: boolean;
  /** Whether each row offers taking the relation off the graph outright, which
   * is an administrator's decision and nobody else's. */
  canRemove?: boolean;
  /** Who held each seat before, keyed by the edge id of the spell that took it
   * over. Optional because most callers of this card do not ask
   * `/api/edges/successions` at all - and because the successions of a company
   * page's rows are somebody else's, not this person's.
   *
   * The endpoint answers per post rather than per edge, so a caller builds this
   * with `predecessorsByEdge` (app/utils/succession.ts) rather than by hand. */
  predecessors?: Record<string, Predecessor>;
}>();

const emit = defineEmits<{
  add: [];
  sources: [edge: EdgeNode];
  remove: [edge: EdgeNode];
}>();

/** How many articles a relation is cited to. An edge that predates
 * `references`, or one the graph returned without it, counts as none rather
 * than breaking the row. */
function sourceCount(edge: EdgeNode) {
  return edge.references?.length ?? 0;
}

const edgesSorted = computed(() => {
  return props.edges.toSorted((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;

    return b.start_date.localeCompare(a.start_date);
  });
});

const minStart = computed(() => {
  return edgesSorted.value
    .map((e) => e.start_date)
    .filter((d): d is string => !!d)
    .toSorted((a, b) => a?.localeCompare(b))[0];
});

const maxEnd = computed(() => {
  return new Date().toISOString().split("T")[0];
});

/** What the row calls the relation.
 *
 * `edge.label` is the edge's own name, which for a supervisory seat is
 * "Rada Nadzorcza" whatever the institution's organ is really called - so a
 * hospital's rada społeczna would read as a supervisory board it does not
 * have. See `displayRole`.
 */
function edgeLabel(edge: EdgeNode) {
  return displayRole(edge.label, asCompany(edge)) ?? edge.label;
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

/** Whether the edge asserts a period at all.
 *
 * The card lists every relation a person has, not only the employment it is
 * named after, and some kinds carry no dates by construction - a `connection`
 * has no date fields in the schema. Drawing a full-width bar for those claims a
 * span nobody recorded, so they get the label and nothing else. */
function isDated(edge: EdgeNode): boolean {
  return !!(edge.start_date || edge.end_date);
}

/** The company behind an edge, when the edge leads to one at all. */
function asCompany(edge: EdgeNode): Company | undefined {
  return edge.richNode.type === "place"
    ? (edge.richNode as Company)
    : undefined;
}

/** The predecessor of one row, as nought or one of them.
 *
 * A list so the template can `v-for` it: `v-if` would mean looking the edge up
 * again for every field it prints, each behind a non-null assertion. */
/** Why a predecessor is hedged, spelled out for whoever hovers it. */
function batchNote(batchSize: number): string {
  return (
    `Tego dnia zmieniło się ${batchSize} stanowisk tej samej funkcji. ` +
    "Rejestr nie wskazuje, kto zajął czyje miejsce."
  );
}

function predecessorOf(edge: EdgeNode): Predecessor[] {
  const predecessor = edge.id ? props.predecessors?.[edge.id] : undefined;
  return predecessor ? [predecessor] : [];
}
</script>

<style scoped>
/* The rows were `base-color="surface-light"`, which paints the whole list a
   low-contrast grey slab. This is `card/Employment.vue`'s idiom instead: a
   white surface, a hairline, and sage kept for the hover border - never for
   ink, which on this theme is 1.85:1. */
.history-row {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.history-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
}

/* Vuetify's own hover overlay on a near-white surface is a grey wash that
   fights the border above. */
.history-row :deep(.v-list-item__overlay) {
  display: none;
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
  font-size: 0.75rem;
  gap: 4px;
  line-height: 1.45;
  margin-top: 7px;
  padding-left: 9px;
}

.history-row__rail-icon {
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.history-row__rail-label {
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.history-row__rail-name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 600;
}

.history-row__rail-gap {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.6875rem;
  line-height: 1.6;
  padding: 0 6px;
}

/* ---- the same row on a phone ----

   Reported as „na telefonie powiązania są cały czas bardzo wysokie": at 375px
   a row measured 140-200px, so two or three of them filled the screen. The
   width is where it starts. Page padding leaves the row 253px of content box,
   and two of its three grid columns are chrome - 56px of icon and up to 98px
   of buttons - so the institution's name, the role, the party, the committee
   and the badge were sharing 99-197px and wrapped four times over.

   Everything below is a breakpoint, not `useDisplay()`: under SSR Vuetify
   builds its display state from a placeholder 1280px width and only corrects
   it once suspense resolves, so a phone would be served the desktop row and
   then watch it collapse. 959.98px is Vuetify's own md boundary, the one the
   `d-md-none` classes in the template switch at. */
@media (max-width: 959.98px) {
  /* Vuetify puts a fixed 32px spacer after a prepend icon and only ever reads
     `--v-list-prepend-gap` from VList's `prependGap` prop, which this card
     does not pass - so the desktop gap applied at every width and the icon
     column cost 56px. Set as a custom property rather than through
     `:deep(.v-list-item__spacer)` because it inherits into the spacer
     VListItem renders for itself; the same declaration also gives the append
     column a gap, which it wants - that spacer carries `order: -1`, so it
     lands between the text and the buttons rather than outside them. */
  .history-row {
    --v-list-prepend-gap: 8px;
  }

  /* An institution's name is the one thing on the row that is worth two lines,
     so it is tightened rather than clamped - "Wojewódzki Fundusz Ochrony
     Środowiska i Gospodarki Wodnej w Łodzi" truncated at two lines is a worse
     row than one that wraps. 1.6 is `.text-subtitle-2`'s line height, which is
     set for a paragraph, not for a heading of three words. */
  .history-row .v-list-item-title {
    line-height: 1.3;
  }

  /* `min-width: 0` is the load-bearing line, not the ellipsis. A flex item's
     automatic minimum size is its min-content width, and the min-content width
     of a `nowrap` string is the whole string - so without this the span refuses
     to shrink, `max-width` loses to it, and the committee overflows the row
     instead of being cut. */
  .history-row__committee {
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* VBtn's 50px minimum is sized for a button with a word in it. These two
     hold an icon and at most one digit, and between them they were taking a
     third of the row. */
  .history-row :deep(.v-btn--size-small) {
    min-width: 0;
  }

  /* `.history-row__rail` is deliberately left alone. Clamping it to two lines
     would mean `display: -webkit-box`, and the rail is a wrapping flex row of
     five things - the arrow, „Wcześniej:", the name, a party chip and the gap
     badge - each of which a webkit box lays out on its own line, so the clamp
     would make it taller, not shorter. A `max-height` in em cannot land on a
     line boundary either, because the chip sets a taller line box than the
     text around it. It is 12px/1.45 and two lines in practice; leave it. */
}
</style>

<template>
  <v-card variant="outlined" class="extraction-card">
    <v-card-text class="pb-3">
      <!-- What readers have made of this fact, off the aggregate it arrived
           with. In the body rather than in the actions row: it is the fact's
           state, not something to click, and the row underneath belongs to
           whoever is judging it. -->
      <div class="fact-status">
        <ExtractionVoteCount
          :state="factReviewState(fact)"
          :voters="factVoterCount(fact)"
        />
      </div>

      <div class="edge">
        <!-- Source entity (left). A fact whose subject the pipeline matched to
         somebody already in the graph says so, and links there: which person a
         fact was attached to is the thing a reviewer most needs to see, and the
         thing most easily got wrong between two people of the same name. -->
        <div class="edge__entity edge__entity--source">
          <div class="edge__name">
            <v-icon
              size="16"
              class="edge__icon me-1"
              :color="personNode ? 'primary' : undefined"
              >{{
                personNode ? mdiAccountCheckOutline : mdiAccountOutline
              }}</v-icon
            >
            <NuxtLink
              v-if="personNode"
              :to="personNode.url"
              class="edge__person-link"
            >
              {{ sourceName }}
            </NuxtLink>
            <span v-else>{{ sourceName }}</span>
          </div>
          <div class="edge__kind">
            {{ personNode ? "osoba w bazie" : "osoba" }}
          </div>
          <ExtractionWrongPersonButton
            v-if="personNode && fact.id"
            :id="fact.id"
            :person-name="personNode.name"
            :reported="reportedWrongPerson"
            class="edge__person-flag"
          />
        </div>

        <!-- Connector (center) -->
        <div class="edge__connector">
          <v-chip
            :color="connectorColor"
            size="small"
            variant="tonal"
            class="edge__chip"
          >
            {{ connectorLabel }}
            <v-icon end size="16">{{ mdiArrowRight }}</v-icon>
          </v-chip>
          <div class="edge__type">{{ typeLabel }}</div>
        </div>

        <!-- Target entity (right) -->
        <div v-if="targetName" class="edge__entity edge__entity--target">
          <div class="edge__name">
            <span>{{ targetName }}</span>
            <v-icon size="16" class="edge__icon ms-1">{{ targetIcon }}</v-icon>
          </div>
          <div v-if="targetKind" class="edge__kind">{{ targetKind }}</div>
        </div>
      </div>
    </v-card-text>

    <template v-if="fact.justification">
      <v-divider />
      <ExtractionQuote
        :fact="fact"
        :link-article="linkArticle"
        inset
        :closing="!$slots.actions"
      />
    </template>

    <!-- Actions row when the parent supplies vote buttons, or when this fact
         can become a relation. -->
    <v-card-actions
      v-if="$slots.actions || promotable"
      class="extraction-actions pt-1"
    >
      <ExtractionPromoteButton
        v-if="promotable"
        :fact="fact"
        @promoted="$emit('promoted', $event)"
      />
      <!-- The caller's controls stay together at the end of the row, and go
           under the button together when the card is too narrow for both: a
           card on a phone is ~295px, and the button, „Dodaj do notatki” and
           three verdicts in one unbroken row pushed the verdicts out of it. -->
      <span class="extraction-actions__own">
        <slot name="actions" />
      </span>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiAccountCheckOutline,
  mdiAccountOutline,
  mdiArrowRight,
} from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import {
  FACT_TYPE_ICONS,
  factTypeLabel,
  factTypeColor,
  factSubject,
  factTarget,
  factConnector,
  factTargetKind,
  factEdgeRule,
  factReviewState,
  factVoterCount,
  factWrongPersonReports,
} from "~/utils/extraction";
import { generateEntityUrl } from "~/composables/slugs";
import {
  ExtractionPromoteButton,
  ExtractionQuote,
  ExtractionVoteCount,
  ExtractionWrongPersonButton,
} from "#components";

const { fact, canPromote, linkArticle } = defineProps<{
  fact: ExtractionFact;
  /** Whether to offer turning this fact into a relation. Off by default, for
   * the swipe deck and the related facts listed under it, where a card is read
   * and judged rather than acted on. The queue, the article's page and a
   * person's page ask for it. */
  canPromote?: boolean;
  /** Link the fact to its article's page on this site - see `ExtractionQuote`,
   * which draws the link. */
  linkArticle?: boolean;
}>();

defineEmits<{ promoted: [edgeId: string] }>();

/** Whether this fact can become a relation here, which is what decides whether
 * the card grows an actions row for the button.
 *
 * False for a fact nobody was matched to, and for the two fact types with no
 * edge type to become - see `factEdgeRule`. */
const promotable = computed(() => !!canPromote && !!factEdgeRule(fact));

const sourceName = computed(() => factSubject(fact));

/** The graph person this fact was matched to, when it was matched to one.
 *
 * Both fields are written together at ingest, so a card missing the name has
 * nothing to build a slug from and is treated as unmatched rather than linked
 * to `/osoba/-<id>`. */
const personNode = computed(() => {
  const { personNodeId, personNodeName } = fact;
  if (!personNodeId || !personNodeName) return undefined;
  return {
    id: personNodeId,
    name: personNodeName,
    url: generateEntityUrl("person", personNodeId, personNodeName),
  };
});

// How many readers have already said the match is wrong, off the aggregate the
// fact already carries.
const reportedWrongPerson = computed(() => factWrongPersonReports(fact));
const targetName = computed(() => factTarget(fact));
const connectorLabel = computed(() => factConnector(fact));
const connectorColor = computed(() => factTypeColor(fact));
const typeLabel = computed(() => factTypeLabel(fact));
const targetKind = computed(() => factTargetKind(fact));
const targetIcon = computed(() => FACT_TYPE_ICONS[fact.fact_type]);
</script>

<style scoped>
/* Named so the stacking rule at the bottom can ask about this card's width
   rather than the window's. */
.extraction-card {
  container: extraction-card / inline-size;
}

/* The vote chip sits over the right-hand entity, where the card has room. The
   gap is on the chip rather than on the row, so a fact nobody has voted on -
   where the chip renders nothing - costs the card no height at all. */
.fact-status {
  display: flex;
  justify-content: flex-end;
}

.fact-status > * {
  margin-bottom: 6px;
}

.edge {
  display: grid;
  /* Cap the connector column so a long role label wraps inside its chip
     instead of squeezing the entity names. */
  grid-template-columns: 1fr minmax(auto, 40%) 1fr;
  align-items: center;
  gap: 8px 12px;
}

.edge__entity {
  /* allow long names to wrap instead of overflowing / truncating */
  min-width: 0;
  overflow-wrap: anywhere;
}

.edge__entity--source {
  text-align: left;
}

.edge__entity--target {
  text-align: right;
}

.edge__name {
  font-weight: 600;
  line-height: 1.3;
}

.edge__icon {
  opacity: 0.55;
  vertical-align: text-bottom;
}

.edge__kind,
.edge__type {
  font-size: 0.7rem;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.edge__kind {
  margin-top: 2px;
}

/* Underlined only on hover: the name is the card's heading first and a link
   second. */
.edge__person-link {
  color: inherit;
  text-decoration: none;
}

.edge__person-link:hover {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}

/* Pull the flag back into the column the name starts in - a v-btn carries its
   own horizontal padding. */
.edge__person-flag {
  margin-left: -6px;
  margin-top: 2px;
}

.edge__connector {
  text-align: center;
  min-width: 0;
}

/* Let the chip grow vertically so long role labels wrap instead of forcing
   one line. */
.edge__chip {
  height: auto;
  min-height: 24px;
  max-width: 100%;
  padding-top: 4px;
  padding-bottom: 4px;
  white-space: normal;
}

.edge__chip :deep(.v-chip__content) {
  display: inline;
}

.edge__type {
  margin-top: 4px;
}

/* Narrow card: three columns don't fit, so stack into full-width rows.
   Measured against the card rather than the viewport, because a card need not
   be the width of the page - the person page used to put two of them in a
   `md="6"` row, where each was ~424px on a 960px screen and the three-column
   edge left a Polish surname about 115px to wrap in. The threshold is the
   phone one it replaced, so a full-width card behaves exactly as before. */
@container extraction-card (max-width: 420px) {
  .edge {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
}

/* Keep the domain row tight under the quote instead of floating far below. */
.extraction-actions {
  min-height: 0;
  flex-wrap: wrap;
}

/* The row's own gap, which its children had while they were children of the
   row. */
.extraction-actions__own {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}
</style>

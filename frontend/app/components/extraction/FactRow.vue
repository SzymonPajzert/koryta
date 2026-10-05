<template>
  <!-- A line per claim, the rows /qa and the admin lists are made of. What
       the article said, the verdict buttons and the rest are one click away:
       „fakty jako rozkładalne elementy - czyli dopiero jak użytkownik je
       kliknie, to pojawia się cytat”. -->
  <AdminExpandRow
    v-model:expanded="expanded"
    :tone="TONES[state]"
    class="fact-row"
    :class="{ 'fact-row--muted': muted }"
    :data-fact-id="fact.id"
    data-testid="person-fact"
  >
    <template #summary>
      <v-icon
        class="arow-fixed fact-row__icon"
        size="small"
        :icon="FACT_TYPE_ICONS[fact.fact_type]"
        :title="typeLabel"
        :aria-label="typeLabel"
        role="img"
        aria-hidden="false"
      />
      <!-- The far end first and in bold, the way „Historia powiązań” above
           names a company before the role in it. Where from and what readers
           made of it go to the end of the line, and under the claim once the
           line is too narrow for both - a phone, or a long company name -
           rather than squeezing the claim into a column. -->
      <span class="fact-row__line">
        <span class="fact-row__claim text-body-2">
          <span v-if="target" class="fact-row__target">{{ target }}</span>
          <span class="fact-row__connector">
            {{ target ? ` · ${connector}` : connector }}
          </span>
        </span>
        <span class="fact-row__aside">
          <span
            class="fact-row__meta text-caption"
            data-testid="person-fact-meta"
          >
            {{ sourcesLabel }}
          </span>
          <ExtractionVoteCount :state="state" :voters="voters" />
        </span>
      </span>
    </template>

    <!-- One block per article the claim was read from, each with its own
         verdict: a vote is about one extraction - does this quote say this -
         so a reader who confirmed one article's quote has said nothing about
         the next one's, and each vote document stays one extraction's. -->
    <div
      v-for="source in group.sources"
      :key="source.fact.id ?? source.fact.url"
      class="fact-source"
      data-testid="person-fact-source"
    >
      <ExtractionQuote
        v-if="source.fact.justification"
        :fact="source.fact"
        link-article
      />
      <div class="fact-source__actions">
        <ExtractionWrongPersonButton
          v-if="source.fact.id && personName"
          :id="source.fact.id"
          :person-name="personName"
          :reported="factWrongPersonReports(source.fact)"
        />
        <!-- Which of the articles readers have judged, when there is more
             than one; with one, the line itself already says it. -->
        <ExtractionVoteCount
          v-if="group.sources.length > 1"
          :state="factReviewState(source.fact)"
          :voters="factVoterCount(source.fact)"
        />
        <!-- Together at the end, and onto the next line together when a
             phone has no room for the flag beside them. -->
        <span class="fact-source__judge">
          <ExtractionAddToNoteButton :fact="source.fact" :node-id="nodeId" />
          <ExtractionQuickVerdict
            v-if="source.fact.id"
            :id="source.fact.id"
            :votes="source.fact.stats?.votes"
          />
        </span>
      </div>
    </div>

    <!-- The claim's, not an article's: one relation, however many articles
         say it. -->
    <template v-if="promotable" #footer>
      <ExtractionPromoteButton
        :fact="promotion"
        @promoted="emit('promoted', $event)"
      />
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
/** One claim on a person's page, as a line that opens to the articles it was
 * read from.
 *
 * Closed, it is what the fact says and where from - „Spółka X · członkini rady
 * nadzorczej”, „tvn24.pl” - and, where somebody voted, what they made of it.
 * That the site says too much at once is the reviewer's standing complaint,
 * and what they ask for is hiding rather than deleting: the quote, the links
 * out, the verdicts and the note and relation buttons are all still here, in
 * the open row.
 */
import { computed, ref } from "vue";
import {
  FACT_TYPE_ICONS,
  factConnector,
  factEdgeRule,
  factGroupState,
  factGroupVoters,
  factReviewState,
  factTarget,
  factTypeLabel,
  factVoterCount,
  factWrongPersonReports,
  type FactGroup,
  type FactReviewState,
} from "~/utils/extraction";
import { polishCounting } from "~/composables/polish";
import type { RowTone } from "~/composables/rowTone";
import {
  AdminExpandRow,
  ExtractionAddToNoteButton,
  ExtractionPromoteButton,
  ExtractionQuickVerdict,
  ExtractionQuote,
  ExtractionVoteCount,
  ExtractionWrongPersonButton,
} from "#components";

const { group, nodeId, muted } = defineProps<{
  /** The claim, and every article it was read from - see `groupFacts`. */
  group: FactGroup;
  /** The person whose page this is, whose note „Dodaj do notatki” writes to. */
  nodeId: string;
  /** Greyed, as a line under the confirmed ones. A background rather than an
   * opacity: the quote is already at 0.7 of the body colour, and fading the
   * whole line would take it under AA - `surface.muted` keeps the measured
   * pair. */
  muted?: boolean;
}>();

const emit = defineEmits<{ promoted: [edgeId: string] }>();

const expanded = ref(false);

/** The rail down the line's left edge says where the claim stands, so a
 * confirmed one reads as such before anything is opened. */
const TONES: Record<FactReviewState, RowTone> = {
  confirmed: "success",
  disputed: "warning",
  unreviewed: "neutral",
};

const fact = computed(() => group.fact);
const state = computed(() => factGroupState(group));
const voters = computed(() => factGroupVoters(group));
const typeLabel = computed(() => factTypeLabel(fact.value));
const target = computed(() => factTarget(fact.value));
const connector = computed(() => factConnector(fact.value));

/** Singular, plural and genitive plural, as `polishCounting` takes them. */
const SOURCE_FORMS: [string, string, string] = ["źródło", "źródła", "źródeł"];

/** Where the claim comes from: the paper, when there is one, and how many
 * there are otherwise. */
const sourcesLabel = computed(() => {
  if (group.sources.length > 1) {
    return polishCounting(group.sources.length, ...SOURCE_FORMS);
  }
  return fact.value.articleDomain || "artykuł";
});

/** The name the flag says the fact is not about. Every source was matched to
 * the same person - it is part of what makes them one claim. */
const personName = computed(() => fact.value.personNodeName);

const promotable = computed(() => !!factEdgeRule(fact.value));

/** What „Utwórz powiązanie” is made from. A source whose article has a page
 * here, where there is one, so the relation cites it; and the relation any of
 * the extractions already became, so the line says so whichever article it
 * was promoted from. */
const promotion = computed(() => {
  const extractions = group.sources.flatMap((source) => [
    source.fact,
    ...source.twins,
  ]);
  const cited =
    group.sources.find((source) => source.fact.articleNodeId)?.fact ??
    fact.value;
  return {
    ...cited,
    promotedEdgeIds: extractions.flatMap(
      (extraction) => extraction.promotedEdgeIds ?? [],
    ),
  };
});
</script>

<style scoped>
/* Drawn back rather than faded, like a greyed card: `surface.muted` under the
   same inks keeps the measured contrast. The open header takes its tint from
   the row's tone either way. */
.fact-row--muted {
  background: rgb(var(--v-theme-surface-muted));
}

.fact-row__icon {
  color: rgb(var(--v-theme-ink-neutral));
}

/* The claim and where it is from, on one line while they fit and on two once
   they do not: the claim wraps rather than being cut, because it is the whole
   of what a closed line says. */
.fact-row__line {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px;
  padding-block: 4px;
}

.fact-row__claim {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.fact-row__target {
  font-weight: 600;
}

.fact-row__connector {
  color: rgb(var(--v-theme-ink-neutral));
}

.fact-row__aside {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.fact-row__meta {
  color: rgb(var(--v-theme-ink-neutral));
}

.fact-source + .fact-source {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.fact-source__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.fact-source__judge {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}

/* Under the claim on a phone, where it is read next, rather than pushed to
   the far edge of a line of its own. */
@media (max-width: 599.98px) {
  .fact-row__aside {
    margin-left: 0;
  }
}
</style>

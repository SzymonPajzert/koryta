<template>
  <v-card variant="outlined" class="extraction-card">
    <v-card-text class="pb-3">
      <div class="edge">
        <!-- Source entity (left) -->
        <div class="edge__entity edge__entity--source">
          <div class="edge__name">
            <v-icon size="16" class="edge__icon me-1">{{
              mdiAccountOutline
            }}</v-icon>
            <span>{{ sourceName }}</span>
          </div>
          <div class="edge__kind">osoba</div>
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
      <!-- Quote links to the article, deep-linked to the passage via a text
       fragment. Falls back to a plain block when there's no article URL. -->
      <component
        :is="sourceHref ? 'a' : 'div'"
        :href="sourceHref"
        :target="sourceHref ? '_blank' : undefined"
        :rel="sourceHref ? 'noopener noreferrer' : undefined"
        class="source-block"
        :class="{ 'source-block--link': sourceHref }"
      >
        <v-card-text class="pt-3" :class="$slots.actions ? 'pb-0' : 'pb-4'">
          <div
            class="source-caption text-caption mb-1 d-flex align-center ga-1"
            :class="sourceHref ? 'text-primary' : 'text-medium-emphasis'"
          >
            <span>{{ sourceCaption }}</span>
            <v-icon v-if="sourceHref" size="13">{{ mdiOpenInNew }}</v-icon>
          </div>
          <blockquote class="extraction-quote text-body-2">
            {{ fact.justification }}
          </blockquote>
        </v-card-text>
      </component>
    </template>

    <!-- Actions row only when the parent supplies vote buttons. -->
    <v-card-actions v-if="$slots.actions" class="extraction-actions pt-1">
      <v-spacer />
      <slot name="actions" />
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiAccountOutline,
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiDomain,
  mdiOpenInNew,
} from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";
import {
  factTypeLabel,
  factTypeColor,
  factSubject,
  factTarget,
  factConnector,
  factTargetKind,
} from "~/utils/extraction";

const { fact } = defineProps<{
  fact: ExtractionFact;
}>();

const sourceName = computed(() => factSubject(fact));
const targetName = computed(() => factTarget(fact));
const connectorLabel = computed(() => factConnector(fact));
const connectorColor = computed(() => factTypeColor(fact));
const typeLabel = computed(() => factTypeLabel(fact));
const targetKind = computed(() => factTargetKind(fact));

const targetIcon = computed(() => {
  if (fact.fact_type === "employment") return mdiDomain;
  if (fact.fact_type === "party_membership") return mdiAccountGroupOutline;
  return mdiAccountOutline; // personal_relation
});

// Encode for a URL text fragment (#:~:text=). Like encodeURIComponent, but
// also encodes "-" since it's a delimiter in the text-fragment grammar.
function encodeFragment(text: string): string {
  return encodeURIComponent(text).replace(/-/g, "%2D");
}

// Build the "text=" part of a scroll-to-text-fragment. Short quotes match
// whole; long ones use textStart,textEnd so a middle mismatch can't break it.
function textFragment(quote: string): string | undefined {
  const cleaned = quote
    .replace(/[„""»«]/g, "") // strip typographic quotes the extractor adds
    .replace(/\s*(?:\.\.\.|…)\s*/g, " ") // truncation markers → space
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;

  const words = cleaned.split(" ");
  if (words.length <= 10) return `text=${encodeFragment(cleaned)}`;

  const start = words.slice(0, 5).join(" ");
  const end = words.slice(-5).join(" ");
  return `text=${encodeFragment(start)},${encodeFragment(end)}`;
}

// Link to the source article, deep-linked to the quoted passage. articleUrl is
// stored without a protocol (e.g. "tvn24.pl/..."). Prefer justification_in_text
// (verbatim from the article) so the highlight actually lands.
const sourceHref = computed(() => {
  const raw = fact.articleUrl;
  if (!raw) return undefined;
  const base = raw.includes("://") ? raw : `https://${raw}`;
  const quote = fact.justification_in_text || fact.justification;
  const fragment = quote ? textFragment(quote) : undefined;
  return fragment ? `${base}#:~:${fragment}` : base;
});

// Names the destination so the reader sees where the link goes.
const sourceCaption = computed(() => {
  if (!sourceHref.value) return "Fragment artykułu";
  return fact.articleDomain
    ? `Zobacz artykuł na ${fact.articleDomain}`
    : "Zobacz artykuł";
});
</script>

<style scoped>
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

/* Phones: three columns don't fit, so stack into full-width rows. */
@media (max-width: 599px) {
  .edge {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
}

.source-block {
  display: block;
  color: inherit;
  text-decoration: none;
}

.source-block--link {
  cursor: pointer;
}

.source-block--link:hover .extraction-quote {
  color: rgba(var(--v-theme-primary), 1);
  border-left-color: rgba(var(--v-theme-primary), 0.9);
}

.extraction-quote {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.4);
  padding-left: 12px;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.7);
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

/* Keep the domain row tight under the quote instead of floating far below. */
.extraction-actions {
  min-height: 0;
}
</style>

<template>
  <div class="source-block-wrap">
    <!-- Quote links to the article, deep-linked to the passage via a text
     fragment. Falls back to a plain block when there's no article URL. -->
    <component
      :is="sourceHref ? 'a' : 'div'"
      :href="sourceHref"
      :target="sourceHref ? '_blank' : undefined"
      :rel="sourceHref ? 'noopener noreferrer' : undefined"
      class="source-block"
      :class="{
        'source-block--link': sourceHref,
        'source-block--inset': inset,
        'source-block--closing': inset && closing,
      }"
    >
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
    </component>

    <!-- The way back when the browser drops the highlight.
         The `#:~:text=` fragment is in the href on every click path, but a
         tab opened in the background - which is what ctrl+click does, and
         how a reader checking sources actually clicks - is throttled by
         the browser and often loads without ever applying it. Nothing in
         the link can fix that, so the quote is offered as text to paste
         into the article's own find bar. Outside the `<a>`, because a
         button nested in an anchor is invalid html and swallows the
         link. -->
    <v-btn
      v-if="sourceHref && quoteText"
      icon
      size="x-small"
      variant="text"
      density="comfortable"
      class="source-copy"
      :class="{ 'source-copy--inset': inset }"
      :aria-label="copied ? 'Skopiowano cytat' : 'Kopiuj cytat'"
      data-testid="extraction-copy-quote"
      @click="copyQuote"
    >
      <v-icon size="16">{{ copied ? mdiCheck : mdiContentCopy }}</v-icon>
      <v-tooltip activator="parent" location="top" max-width="260">
        {{
          copied
            ? "Skopiowano"
            : "Kopiuj cytat, żeby znaleźć go w artykule (Ctrl+F)"
        }}
      </v-tooltip>
    </v-btn>

    <!-- The other way out of the quote: to the article's page here rather
         than to the newspaper. „Jak przejść do widoku artykułu?” was asked
         from a person's page, where the quote was the only link and led
         off the site. Outside the `<a>` for the same reason as the button
         above; worded like the card's own „osoba w bazie”. -->
    <div
      v-if="articlePage"
      class="source-article"
      :class="{ 'source-article--inset': inset }"
    >
      <NuxtLink
        :to="articlePage"
        class="link-plain text-caption d-inline-flex align-center ga-1"
        data-testid="extraction-article-page"
      >
        <v-icon :icon="mdiFileDocumentOutline" size="13" />
        Artykuł w bazie
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
/** The sentence a fact was read from, and the ways out of it: to the passage in
 * the article, to the article's page here, and - where a browser drops the
 * highlight - to the clipboard.
 *
 * A card draws one under the fact it states. A line on a person's page draws
 * one per article the claim was read from, which is why this is its own
 * component rather than a part of the card.
 */
import { computed, ref } from "vue";
import {
  mdiCheck,
  mdiContentCopy,
  mdiFileDocumentOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import type { ExtractionFact } from "~~/shared/model";

const { fact, linkArticle, inset, closing } = defineProps<{
  fact: ExtractionFact;
  /** Link the fact to its article's page on this site, when ingest matched
   * the article to one (`articleNodeId`). Off by default because the article's
   * own page draws these quotes too, and there the link would lead back to
   * where the reader already is. */
  linkArticle?: boolean;
  /** Padded as a section of a card, to the card's own 16px, with the padding
   * inside the link so all of the section is the click target. Off, the quote
   * sits flush in whatever holds it. */
  inset?: boolean;
  /** Nothing follows it on the card, so it keeps the card's bottom padding. */
  closing?: boolean;
}>();

/** The article's page here. By id alone, like a note's source links to it: the
 * fact carries no title to build the readable slug from, and `/entity/` sends
 * the reader on to it. Only signed-in readers are ever shown a fact, so no
 * crawler follows this through the redirect. */
const articlePage = computed(() =>
  linkArticle && fact.articleNodeId
    ? generateEntityUrl("article", fact.articleNodeId)
    : undefined,
);

// Encode for a URL text fragment (#:~:text=). Like encodeURIComponent, but
// also encodes "-" since it's a delimiter in the text-fragment grammar.
function encodeFragment(text: string): string {
  return encodeURIComponent(text).replace(/-/g, "%2D");
}

/** The quote as the article actually renders it.
 *
 * `justification_in_text` is verbatim from the article, but it comes out of
 * the pipeline's tokeniser: it says "Gospodarki Komunalnej ." and "Piotr Breś
 * , pełnomocnik" where the page says "Komunalnej." and "Breś,". A text
 * fragment matches on rendered text, so that stray space is enough to lose the
 * highlight - it accounted for most of the misses in a run over the 200 newest
 * facts. Closing it up is safe for Polish; a language that sets a real space
 * before its punctuation would need this dropped. */
function cleanQuote(quote: string): string {
  return quote
    .replace(/[„""»«]/g, "") // strip typographic quotes the extractor adds
    .replace(/\s*(?:\.\.\.|…)\s*/g, " ") // truncation markers → space
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .trim();
}

/** Sentence-sized runs of the quote: long enough not to match some other
 * paragraph of the same article, short enough to survive one word drifting. */
function quoteRuns(cleaned: string): string[] {
  return (cleaned.match(/[^.!?:]+[.!?:]*/g) ?? [])
    .map((part) => part.trim().split(" ").slice(0, 8).join(" "))
    .filter((part) => part.split(" ").length >= 5)
    .slice(0, 4);
}

/** The "text=" directives of a scroll-to-text-fragment.
 *
 * A short quote is asked for whole. A long one is asked for as a
 * textStart,textEnd range *and*, after it, as its individual sentences: a
 * range is all-or-nothing and neither of its ends may cross a block boundary,
 * so wherever the scraper glued a subheading onto the paragraph under it - the
 * rmf24.pl case a reader reported - the five opening words straddle an `</h2>`
 * and the whole range fails silently, taking the tail with it. Every directive
 * is matched independently and the browser scrolls to the first one that hit,
 * so the sentences cost nothing while the range works and are the only thing
 * that lands when it does not. */
function textFragment(quote: string): string | undefined {
  const cleaned = cleanQuote(quote);
  if (!cleaned) return undefined;

  const words = cleaned.split(" ");
  if (words.length <= 10) return `text=${encodeFragment(cleaned)}`;

  const start = words.slice(0, 5).join(" ");
  const end = words.slice(-5).join(" ");
  return [
    `text=${encodeFragment(start)},${encodeFragment(end)}`,
    ...quoteRuns(cleaned).map((run) => `text=${encodeFragment(run)}`),
  ].join("&");
}

/** What the link points at and what the copy button hands over, so the two can
 * never disagree about which passage is being talked about. */
const quoteText = computed(
  () => fact.justification_in_text || fact.justification,
);

// Link to the source article, deep-linked to the quoted passage. articleUrl is
// stored without a protocol (e.g. "tvn24.pl/..."). Prefer justification_in_text
// (verbatim from the article) so the highlight actually lands.
const sourceHref = computed(() => {
  const raw = fact.articleUrl;
  if (!raw) return undefined;
  const base = raw.includes("://") ? raw : `https://${raw}`;
  const fragment = quoteText.value ? textFragment(quoteText.value) : undefined;
  return fragment ? `${base}#:~:${fragment}` : base;
});

/** Names the destination, and promises the passage rather than the article: a
 * reader whose browser did not scroll should at least be able to tell that
 * something was supposed to happen. */
const sourceCaption = computed(() => {
  if (!sourceHref.value) return "Fragment artykułu";
  return fact.articleDomain
    ? `Zobacz cytat na ${fact.articleDomain}`
    : "Zobacz cytat w artykule";
});

const copied = ref(false);

/** Hands the quote to the clipboard, for the article's own find bar.
 *
 * The same normalised string the link is built from, rather than the sentence
 * rendered above: the find bar matches the article's own text just as a text
 * fragment does, so the tokeniser's „Komunalnej ." would come back empty. */
async function copyQuote() {
  if (!quoteText.value) return;
  try {
    await navigator.clipboard.writeText(cleanQuote(quoteText.value));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // An insecure origin or a refused permission throws here. Nothing to say
    // about it: the quote is on screen a centimetre below, selectable by hand.
  }
}
</script>

<style scoped>
.source-block-wrap {
  position: relative;
}

.source-block {
  display: block;
  color: inherit;
  text-decoration: none;
  overflow-wrap: break-word;
}

/* A card's section: its 16px sides and the 12px under the divider above. */
.source-block--inset {
  padding: 12px 16px 0;
}

.source-block--closing {
  padding-bottom: 16px;
}

/* Over the caption's right end, which is where the row runs out. It is a
   fallback control, so it stays quiet until the quote is hovered or it takes
   keyboard focus. Pulled up and out by its own padding when the quote sits
   flush, so its icon still lines up with the caption. */
.source-copy {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 1;
  opacity: 0.55;
}

.source-copy--inset {
  top: 8px;
  right: 8px;
}

.source-block-wrap:hover .source-copy,
.source-copy:focus-visible {
  opacity: 1;
}

.source-block--link {
  cursor: pointer;
}

.source-article {
  padding-top: 4px;
}

/* Under the quote and in line with it - the quote's bar starts at the card's
   own 16px padding. */
.source-article--inset {
  padding: 4px 16px 0;
}

/* Room for the copy button that floats over this row's right end. */
.source-caption {
  padding-right: 28px;
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
</style>

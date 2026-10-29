<template>
  <!-- TEMP(wariant) a „linia”: one quiet line under the person's facts. -->
  <div
    v-if="look === 'line'"
    class="decl-line"
    data-nosnippet
    data-testid="person-declarations"
  >
    <v-icon
      :icon="mdiFileDocumentCheckOutline"
      size="18"
      color="ink-sage"
      class="decl-line__icon"
    />
    <p class="decl-line__text">
      <template v-for="(part, i) in lineParts" :key="i">
        <a
          v-if="part.url"
          :href="part.url"
          target="_blank"
          rel="noopener"
          :aria-label="part.label"
          class="decl-link"
          >{{ part.text
          }}<v-icon :icon="mdiOpenInNew" size="14" class="decl-link__icon"
        /></a>
        <template v-else>{{ part.text }}</template>
      </template>
      <span class="decl-info">
        <InfoBubble :label="title">{{ method }}</InfoBubble>
      </span>
    </p>
  </div>

  <!-- TEMP(wariant) b „fakt”: one more fact in the idiom of CardPersonInfo
       above it - its label over the links, the publication a caption under
       them. A plain block rather than another v-row: a row after a row gets
       Vuetify's 12px on top of the grid's own gap, and the fact sat 20px
       lower than a fact of the grid would. -->
  <div
    v-else-if="look === 'fact'"
    class="decl-fact"
    data-nosnippet
    data-testid="person-declarations"
  >
    <!-- The label exactly as CardPersonInfo draws its own, so the fact reads
         as one of the grid's rather than as a note about it. The (i) beside
         it rather than in it: the label's box clips what overflows it, the
         (i)'s focus ring included. -->
    <div class="decl-fact__head">
      <v-list-subheader
        class="px-0 text-uppercase font-weight-bold"
        style="min-height: 24px"
        >{{ title }}</v-list-subheader
      >
      <InfoBubble :label="title">{{ method }}</InfoBubble>
    </div>
    <div v-for="group in groups" :key="group.key" class="decl-fact__value">
      <span>
        <template v-for="(shown, i) in group.declarations" :key="shown.url">
          <template v-if="i > 0">{{ joiner(i, group.declarations) }}</template>
          <a
            :href="shown.url"
            target="_blank"
            rel="noopener"
            :aria-label="shown.factLabel"
            class="decl-link"
            >{{ i === 0 ? capitalised(shown.factText) : shown.factText
            }}<v-icon :icon="mdiOpenInNew" size="14" class="decl-link__icon"
          /></a>
        </template>
      </span>
      <span class="decl-fact__where"
        >{{ group.first.place }}
        <span class="decl-nowrap">{{ group.first.bracket }}</span></span
      >
    </div>
    <p class="decl-fact__caption">{{ caption }}</p>
  </div>

  <!-- TEMP(wariant) c „sekcja”, the header's half: one line that says what
       happened and points down to the section with the documents. -->
  <div
    v-else-if="look === 'pointer'"
    class="decl-line"
    data-nosnippet
    data-testid="person-declarations-pointer"
  >
    <v-icon
      :icon="mdiFileDocumentCheckOutline"
      size="18"
      color="ink-sage"
      class="decl-line__icon"
    />
    <p class="decl-line__text">
      {{ sentenceLead
      }}<a
        v-if="declarations.length > 0"
        :href="`#${SECTION_ID}`"
        class="decl-link decl-link--wraps"
        >{{ nounHead }}
        <span class="decl-nowrap"
          >{{ nounTail
          }}<v-icon
            :icon="mdiArrowDown"
            size="14"
            class="decl-link__icon" /></span></a
      ><template v-else>{{ declarationNoun }}</template
      >.
    </p>
  </div>

  <!-- TEMP(wariant) c „sekcja”, the section's half: the documents as cards,
       beside the articles that name the person. -->
  <PageSection
    v-else-if="look === 'section'"
    :id="SECTION_ID"
    :title="title"
    :icon="mdiFileDocumentCheckOutline"
    class="decl-section"
    data-nosnippet
    data-testid="person-declarations"
  >
    <template #lead>
      <p class="k-lead">{{ sectionLead }}</p>
    </template>
    <template #info>{{ method }}</template>

    <v-row dense>
      <v-col v-for="shown in declarations" :key="shown.url" cols="12" md="6">
        <a
          :href="shown.url"
          target="_blank"
          rel="noopener"
          :aria-label="shown.cardLabel"
          class="k-card decl-card"
        >
          <v-avatar
            v-if="shown.icon"
            :image="shown.icon"
            size="24"
            class="decl-card__icon"
          />
          <span class="decl-card__body">
            <span class="decl-card__title">{{ shown.cardTitle }}</span>
            <span class="decl-card__meta"
              >{{ shown.place }}
              <span class="decl-nowrap">{{ shown.bracket }}</span></span
            >
            <span v-if="shown.host" class="decl-card__meta">
              {{ shown.host }}
              <v-icon :icon="mdiOpenInNew" size="12" class="decl-card__out" />
            </span>
          </span>
        </a>
      </v-col>
    </v-row>
  </PageSection>
</template>

<script setup lang="ts">
/** What a person's page says about their asset declarations (oświadczenia
 * majątkowe) on BIP: that the site published the page itself, and why, with
 * the declarations linked so a reader can check them on the office's own
 * site.
 *
 * Everyone sees it, logged out readers included - the page is public by the
 * time there is anything to say: the endpoint answers 404 for a page that is
 * not, and this renders nothing then, as it does while it waits. A reader
 * never gets more than the link and the outcome here: not the crops, not
 * what anybody typed, not how many typed it. How a date is read is said once,
 * in general, behind the (i).
 *
 * Not awaited, like `MentionArticleList`: the note is a footnote to the page
 * and must not hold up the rest of it. And asked for in the browser only:
 * nothing in it is for a search engine (it is all `data-nosnippet`), so the
 * server's render, which is what a crawler gets, does not wait on it either.
 * The price is that the note arrives a moment after the page and moves the
 * bio down by its height - on the few pages that have one.
 */
import { computed } from "vue";
import {
  mdiArrowDown,
  mdiFileDocumentCheckOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { plural } from "~/utils/jobStyle";
import { longDate, warsawDate } from "~~/shared/dates";
import {
  READERS_TO_AGREE,
  type PersonDeclarations,
} from "~~/shared/declarations";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    /** Where the page put this copy: under the person's facts, or as a
     * section of its own further down. Only variant c draws the second. */
    placement?: "header" | "section";
  }>(),
  { placement: "header" },
);

/** The section's anchor, for the header's pointer to scroll to. */
const SECTION_ID = "oswiadczenia-majatkowe";

const route = useRoute(); // TEMP(wariant)
const isB = computed(() => route.query.wariant === "b"); // TEMP(wariant)
const isC = computed(() => route.query.wariant === "c"); // TEMP(wariant)

const { getDomainIcon } = useDomainIcon();

// A key per placement: variant c mounts this twice, and two `useAsyncData`
// calls under one key with two handlers is a pairing Nuxt warns about.
const { data } = useAsyncData<PersonDeclarations>(
  `person-declarations-${props.placement}-${props.nodeId}`,
  () =>
    authRequest<PersonDeclarations>(`/api/nodes/${props.nodeId}/declarations`, {
      method: "GET",
    }),
  { server: false, lazy: true },
);

/** One declaration as the variants print it. */
type ShownDeclaration = {
  url: string;
  year: number | null;
  /** „Rada gminy · Strzelin (gmina miejsko-wiejska)”: whole, to group by. */
  where: string;
  /** The same in two pieces, so the brackets never break across lines -
   * „miejsko-” at the end of one and „wiejska)” on the next is what a phone
   * did with it. */
  place: string;
  bracket: string;
  /** „Rada gminy, Strzelin”: variant a's, short enough to keep the sentence
   * on one line of a desktop. */
  brief: string;
  host: string | null;
  /** The site's favicon, for the card of variant c. */
  icon: string;
  /** The link's words inside the sentence of variant a: „za 2023”. */
  lineText: string;
  /** The same as a value of the facts grid: „za rok 2023”, capitalised when
   * it starts the line. */
  factText: string;
  cardTitle: string;
  /** What a screen reader says for each variant's link, which it hears
   * without the place beside it. Each starts with the words the link shows,
   * so a reader who steers by voice can name the link by what they see. */
  lineLabel: string;
  factLabel: string;
  cardLabel: string;
};

/** The unit's bracket, „(gmina miejsko-wiejska)” or a powiat's seat. */
const BRACKET = /\s*(\([^()]*\))$/;

/** A link's accessible name: its parts in the order a reader sees them,
 * and where it opens. */
function spokenAs(...parts: (string | null)[]): string {
  return [...parts, "otwiera się w nowej karcie"].filter(Boolean).join(", ");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Newest first, each document once: one file can serve two candidacies of
 * the same person, and the endpoint may list it for both. */
const declarations = computed<ShownDeclaration[]>(() => {
  const seen = new Set<string>();
  return (data.value?.declarations ?? [])
    .filter((declaration) => {
      if (!declaration.url || seen.has(declaration.url)) return false;
      seen.add(declaration.url);
      return true;
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .map((declaration) => {
      // The office before the unit, joined rather than declined: „Rada
      // gminy” and „Strzelin (gmina miejsko-wiejska)” make „Rada Gminy
      // Strzelin” only with a grammar of Polish place names the site does
      // not have. The unit is the pipeline's own name for it, brackets and
      // all: two gminas can share a name, and the seat in brackets is what
      // tells the two nowodworskie powiats apart.
      const bracket = BRACKET.exec(declaration.unit)?.[1] ?? "";
      const unit = declaration.unit.replace(BRACKET, "");
      const office = declaration.office ?? "";
      const spoken = [office, declaration.unit].filter(Boolean).join(", ");
      const host = hostOf(declaration.url);
      const year = declaration.year;
      const cardTitle = year
        ? `Oświadczenie majątkowe za ${year}`
        : "Oświadczenie majątkowe";
      const lineText = year ? `za ${year}` : "w BIP";
      const factText = year ? `za rok ${year}` : "dokument w BIP";
      return {
        url: declaration.url,
        year,
        where: [office, declaration.unit].filter(Boolean).join(" · "),
        place: [office, unit].filter(Boolean).join(" · "),
        bracket,
        brief: [office, unit].filter(Boolean).join(", "),
        host,
        icon: getDomainIcon(declaration.url),
        lineText,
        factText,
        cardTitle,
        lineLabel: spokenAs(`Oświadczenie majątkowe ${lineText}`, spoken),
        factLabel: year
          ? spokenAs(`Oświadczenie majątkowe ${factText}`, spoken)
          : spokenAs("Oświadczenie majątkowe", factText, spoken),
        cardLabel: spokenAs(cardTitle, spoken, host),
      };
    });
});

/** „za rok 2023” at the start of a line. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The documents by the office and unit they were filed with, so a
 * councillor's 2023 and 2022 declarations to the same council print the
 * council once. */
const groups = computed(() => {
  const byPlace = new Map<string, ShownDeclaration[]>();
  for (const shown of declarations.value) {
    byPlace.set(shown.where, [...(byPlace.get(shown.where) ?? []), shown]);
  }
  return [...byPlace].map(([key, filed]) => ({
    key,
    declarations: filed,
    first: filed[0]!,
  }));
});

/** A no-break space. Polish keeps a one-letter word on the line of the word
 * after it - a „z” or an „i” left at the end of a line reads as a slip - and
 * a date in one piece: „29” on one line and „października” on the next is
 * what a phone did with it. */
const NBSP = "\u00a0";

/** „za 2023, za 2022 i za 2021”. */
function joiner(index: number, list: readonly unknown[]): string {
  return index === list.length - 1 ? ` i${NBSP}` : ", ";
}

const autoPublished = computed(() => !!data.value?.autoPublished);

/** The Warsaw day of the publication, „29 października 2026”: the server
 * writes an instant, and a reader cares about the day. */
const publishedOn = computed(() => {
  const at = data.value?.autoPublished?.at;
  if (!at) return "";
  const instant = new Date(at);
  if (isNaN(instant.getTime())) return "";
  return longDate(warsawDate(instant), "").replaceAll(" ", NBSP);
});

const many = computed(() => declarations.value.length > 1);

const title = computed(() =>
  many.value ? "Oświadczenia majątkowe" : "Oświadczenie majątkowe",
);

/** The declaration as the sentence's object: „z oświadczeniem majątkowym”. */
const declarationNoun = computed(() =>
  many.value ? "oświadczeniami majątkowymi" : "oświadczeniem majątkowym",
);

/** The same, split before its last word for variant c's pointer, which may
 * break between the two words but keeps its arrow with the second: whole, the
 * link went to a line of its own on a phone and left „zgadza się” alone on
 * the one above. */
const nounHead = computed(() => declarationNoun.value.split(" ")[0]);
const nounTail = computed(() => declarationNoun.value.split(" ")[1]);

/** „Strona opublikowana automatycznie 29 października 2026: data urodzenia
 * zgadza się z ” and then `object`. Without the publication for a page
 * somebody published by hand, whose date a declaration confirmed later. */
function agreement(object = ""): string {
  const agrees = `data urodzenia zgadza się z${NBSP}${object}`;
  if (!autoPublished.value) return capitalised(agrees);
  return publishedOn.value
    ? `Strona opublikowana automatycznie ${publishedOn.value}: ${agrees}`
    : `Strona opublikowana automatycznie: ${agrees}`;
}

/** The sentence up to its object, which every variant finishes in its own
 * way - with the documents themselves, a pointer, or a full stop. */
const sentenceLead = computed(() => agreement());

/** Variant a, as runs of text and links: one paragraph, so it wraps like a
 * sentence on a phone rather than stacking. */
const lineParts = computed(() => {
  const parts: { text: string; url?: string; label?: string }[] = [
    { text: `${sentenceLead.value}${declarationNoun.value}` },
  ];
  groups.value.forEach((group, g) => {
    parts.push({ text: g === 0 ? " " : "; " });
    group.declarations.forEach((shown, i) => {
      if (i > 0) parts.push({ text: joiner(i, group.declarations) });
      parts.push({
        text: shown.lineText,
        url: shown.url,
        label: shown.lineLabel,
      });
    });
    if (group.first.brief) parts.push({ text: ` (${group.first.brief})` });
  });
  parts.push({ text: "." });
  return parts;
});

/** Variant b's caption under the documents. The label above already names
 * the declaration, so the caption does not. */
const caption = computed(
  () => `${agreement(many.value ? "oświadczeniami" : "oświadczeniem")}.`,
);

const sectionLead = computed(() =>
  many.value
    ? "Dokumenty z BIP z tą samą datą urodzenia co na tej stronie."
    : "Dokument z BIP z tą samą datą urodzenia co na tej stronie.",
);

/** „co najmniej 2 osoby”: the rule, never this crop's count. */
const readers = `co najmniej ${READERS_TO_AGREE} ${plural(READERS_TO_AGREE, "osoba", "osoby", "osób")}`;

/** How a date is read and what the publication brought with it - the
 * method, which a reader may want and does not need to follow the link. In
 * general terms on purpose: nothing here is about this person's crop. A
 * typed date is read by the job alone (Szymon, 2026-10-29), so the readers
 * are said to read the handwritten ones. The page's date is not said to be
 * KRS's: it can come from Wikipedia or an editor as well. The limit is not
 * given as a number - it lives in the runtime config, not on this page. */
const method = computed(() => {
  const read =
    "Samorządowcy co roku składają oświadczenia majątkowe, a urząd " +
    "publikuje je w swoim BIP. Datę urodzenia z oświadczenia odczytuje " +
    "program, gdy jest wpisana na komputerze, a gdy odręcznie - " +
    `${readers}, każda osobno i nie widząc daty z tej strony. Odczyt ` +
    "zgadza się z datą urodzenia na tej stronie, więc to oświadczenie tej " +
    "samej osoby.";
  if (!autoPublished.value) return withoutOrphans(read);
  return withoutOrphans(
    `${read} Dlatego strona została opublikowana automatycznie, w ramach ` +
      "dziennego limitu, razem ze stanowiskami z KRS i startami w wyborach " +
      "do tego samorządu.",
  );
});

/** Every one-letter word bound to the word after it, as the line binds its
 * own by hand: the (i)'s box breaks the text wherever its width runs out. */
function withoutOrphans(text: string): string {
  return text.replace(/(^|\s)([aiouwz]) /gi, `$1$2${NBSP}`);
}

/** Which piece to draw here, if any. Nothing at all until the answer is in,
 * and nothing for a page with nothing to say. */
const look = computed(() => {
  if (!autoPublished.value && declarations.value.length === 0) return null;
  // A section is its documents: without one it would be a heading over
  // nothing, and the header's line then says all there is.
  if (props.placement === "section") {
    return declarations.value.length > 0 ? "section" : null;
  }
  if (isB.value) return "fact"; // TEMP(wariant)
  if (isC.value) return "pointer"; // TEMP(wariant)
  return "line";
});
</script>

<style scoped>
/* Under the facts it is about, and further from the bio than from them: the
   facts' row already ends in 20px of its own, so the line takes nothing above
   and 24px below. */
.decl-line {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  margin: 0 0 24px;
}

.decl-line__icon {
  flex: none;
  /* Centres the 18px icon on the first 20px line of text. */
  margin-top: 1px;
}

.decl-line__text {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.25rem;
  margin: 0;
  text-wrap: pretty;
}

/* Meta text in the neutral ink, the document in the sage one: sage is the
   site's colour but a fill, never text - `ink.sage` is the shade of it that
   reads at 14px (6.43:1 on white). The two inks are the same lightness, so
   the link is told apart by its underline as well, not by its hue alone.
   `nowrap` keeps the arrow with its words: a phone put it at the start of the
   next line, alone. */
.decl-link {
  color: rgb(var(--v-theme-ink-sage));
  font-weight: 500;
  white-space: nowrap;
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-ink-sage), 0.45);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s ease;
}

.decl-link--wraps {
  white-space: normal;
}

.decl-link:hover,
.decl-link:focus-visible {
  text-decoration-color: currentColor;
}

.decl-link:focus-visible {
  border-radius: 2px;
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}

.decl-link__icon {
  margin-inline-start: 2px;
  vertical-align: -2px;
}

/* The (i) after the last word, as on a section heading; a gap rather than a
   space, which the template would not keep. */
.decl-info {
  margin-inline-start: 6px;
}

/* The 24px one fact of the grid stands under another: the 12px of padding
   the facts' last column ends in, and this 12px, which takes the place of the
   row's 8px (`mb-2`) as two margins that meet do. */
.decl-fact {
  margin: 12px 0 20px;
}

.decl-fact__head {
  align-items: center;
  display: flex;
  gap: 6px;
}

.decl-fact__value {
  align-items: baseline;
  column-gap: 8px;
  display: flex;
  flex-wrap: wrap;
  font-size: 1rem;
  line-height: 1.5;
}

.decl-fact__where {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
}

.decl-nowrap {
  white-space: nowrap;
}

.decl-fact__caption {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 4px 0 0;
  text-wrap: pretty;
}

/* Clear of the app bar when the header's pointer scrolls here. */
.decl-section {
  scroll-margin-top: 80px;
}

/* `k-card` (app.vue) draws the edge and the hover, as on every other card of
   the page; this lays out what is inside it. A link, so the whole card is the
   target - on a phone the year alone would be a 40px one. */
.decl-card {
  align-items: flex-start;
  color: inherit;
  display: flex;
  gap: 12px;
  height: 100%;
  padding: 12px 16px;
  text-decoration: none;
}

.decl-card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}

.decl-card__icon {
  flex: none;
  margin-top: 2px;
}

.decl-card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.decl-card__title {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.43;
}

.decl-card__meta {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.decl-card__out {
  margin-inline-start: 2px;
  vertical-align: -1px;
}
</style>

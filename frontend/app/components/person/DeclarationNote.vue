<template>
  <!-- One line under the person's facts: what the declarations confirm, and
       for a page the site published itself, that it did. The documents are
       listed with the articles further down; the line points there. -->
  <div
    v-if="declarations.length > 0"
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
      }}<a :href="`#${DECLARATIONS_ANCHOR}`" class="decl-link"
        >{{ nounHead }}
        <span class="decl-nowrap"
          >{{ nounTail
          }}<v-icon
            :icon="mdiArrowDown"
            size="14"
            class="decl-link__icon" /></span></a
      >.<span class="decl-info"
        ><InfoBubble :label="infoLabel">{{ method }}</InfoBubble></span
      >
    </p>
  </div>
</template>

<script setup lang="ts">
/** What a person's page says about their asset declarations (oświadczenia
 * majątkowe) on BIP, under their facts: that the birth date on the page agrees
 * with them, and for a page the site published itself, that it did and when.
 * The documents are listed as cards in the section of articles that mention
 * the person (`MentionArticleList`), not in a section of their own (round
 * bip-osoba-r1). This line points there.
 *
 * Everyone sees it, logged out readers included - the page is public by the
 * time there is anything to say. A reader never gets more than the outcome and
 * the documents: not the crops, not what anybody typed, not how many typed it.
 * How a date is read is said once, in general, behind the (i).
 */
import { computed } from "vue";
import { mdiArrowDown, mdiFileDocumentCheckOutline } from "@mdi/js";
import {
  DECLARATIONS_ANCHOR,
  uniqueDeclarations,
  usePersonDeclarations,
} from "~/composables/personDeclarations";
import { plural } from "~/utils/jobStyle";
import { longDate, warsawDate } from "~~/shared/dates";
import { READERS_TO_AGREE } from "~~/shared/declarations";

const props = defineProps<{ nodeId: string }>();

const { data } = usePersonDeclarations(props.nodeId);

const declarations = computed(() => uniqueDeclarations(data.value));

/** A no-break space. Polish keeps a one-letter word on the line of the word
 * after it - a „z” or an „i” left at the end of a line reads as a slip - and
 * a date in one piece: „29” on one line and „października” on the next is
 * what a phone did with it. */
const NBSP = " ";

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

/** The declarations as the sentence's object: „z oświadczeniem
 * majątkowym”, split before its last word, so the link may break between the
 * two words but keeps its arrow with the second: whole, it went to a line of
 * its own on a phone and left „zgadza się” alone on the one above. */
const declarationNoun = computed(() =>
  declarations.value.length > 1
    ? "oświadczeniami majątkowymi"
    : "oświadczeniem majątkowym",
);
/** What the (i) is about, as its button says: „Co to jest: …”. */
const infoLabel = computed(() =>
  declarations.value.length > 1
    ? "Oświadczenia majątkowe"
    : "Oświadczenie majątkowe",
);
const nounHead = computed(() => declarationNoun.value.split(" ")[0]);
const nounTail = computed(() => declarationNoun.value.split(" ")[1]);

/** „Strona opublikowana automatycznie 29 października 2026: data urodzenia
 * zgadza się z ”, then the link. Without the publication for a page somebody
 * published by hand, whose date a declaration confirmed later: those are
 * linked too (bip-osoba-r1). */
const sentenceLead = computed(() => {
  const agrees = `data urodzenia zgadza się z${NBSP}`;
  if (!autoPublished.value) {
    return agrees.charAt(0).toUpperCase() + agrees.slice(1);
  }
  return publishedOn.value
    ? `Strona opublikowana automatycznie ${publishedOn.value}: ${agrees}`
    : `Strona opublikowana automatycznie: ${agrees}`;
});

/** „co najmniej 2 osoby”: the rule, never this crop's count. */
const readers = `co najmniej ${READERS_TO_AGREE} ${plural(READERS_TO_AGREE, "osoba", "osoby", "osób")}`;

/** How a date is read and what the publication brought with it - the
 * method, which a reader may want and does not need to follow the link. In
 * general terms on purpose: nothing here is about this person's crop. Only a
 * typed date the job is sure of settles without readers;
 * handwriting, scans and a typed date it is unsure of go to them, so the
 * readers are said to read everything else, not the handwritten ones alone.
 * A date an admin settled never reaches this line, nor a reading the page's
 * date no longer matches: the endpoint lists only crops readers or the job
 * settled on that very day (`confirmedDeclarations`). The page's date is not
 * said to be KRS's: it can come from Wikipedia or an editor as well. The
 * limit is not given as a number - it lives in the runtime config, not on
 * this page. */
const method = computed(() => {
  const read =
    "Samorządowcy co roku składają oświadczenia majątkowe, a urząd " +
    "publikuje je w swoim BIP. Datę urodzenia z oświadczenia odczytuje " +
    "program, gdy jest wpisana na komputerze i odczyt jest pewny, a w " +
    `pozostałych przypadkach - ${readers}, każda osobno i nie widząc daty ` +
    "z tej strony. Odczyt zgadza się z datą urodzenia na tej stronie, więc " +
    "to oświadczenie tej samej osoby.";
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

/* Meta text in the neutral ink, the link in the dark sage one rather than
   the blue link ink (bip-osoba-r1): sage is the site's colour but a
   fill, never text - `ink.sage` is the shade of it that reads at 14px (6.43:1
   on white). The two inks are the same lightness, so the link is told apart
   by its underline as well, not by its hue alone. */
.decl-link {
  color: rgb(var(--v-theme-ink-sage));
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-theme-ink-sage), 0.45);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s ease;
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

.decl-nowrap {
  white-space: nowrap;
}

/* The (i) after the full stop, as on a section heading; a gap rather than a
   space, which the template would not keep. */
.decl-info {
  margin-inline-start: 6px;
}
</style>

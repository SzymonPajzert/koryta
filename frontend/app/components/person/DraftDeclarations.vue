<template>
  <!-- Where the public line will be once the page is up (`DeclarationNote`):
       under the facts, as it is about one of them, the birth date. Dashed,
       the site's edge for what is not a record (`k-note`): this is about the
       page's way to publication, not about the person. -->
  <section
    v-if="line"
    class="ddecl k-note"
    :class="{ 'ddecl--rows': line.kind === 'missing' }"
    aria-labelledby="ddecl-line"
    data-nosnippet
    data-testid="person-draft-declarations"
    :data-kind="line.kind"
  >
    <div class="ddecl__line">
      <v-icon :icon="icon" size="18" :color="ink" class="ddecl__icon" />
      <div class="ddecl__words">
        <p id="ddecl-line" class="ddecl__text">{{ line.text }}</p>
        <p v-if="isAdmin && line.note" class="ddecl__note" data-admin-note>
          {{ line.note }}
        </p>
      </div>
    </div>

    <div v-if="line.lead" class="ddecl__clips">
      <PersonDeclarationClip :crop="line.lead" :birth-date="birthDate" />
      <template v-if="showAll">
        <PersonDeclarationClip
          v-for="crop in line.rest"
          :key="crop.id"
          :crop="crop"
          :birth-date="birthDate"
        />
      </template>
    </div>
    <AdminDeclarationsShowAll
      v-if="line.lead"
      v-model="showAll"
      class="ddecl__all text-none"
      :total="line.rest.length + 1"
      :limit="1"
    />

    <!-- No crop: each local election won since 2014 on a line of its own
         (round osoba-szkic-oswiadczenia-r3), its year first, and what the
         crawler found on its unit's BIP, which is where to look by hand. The
         columns line up from row to row on a computer; a phone keeps the
         year at the left and wraps the rest beside it. -->
    <ul v-if="line.searches.length > 0" class="ddecl__searches">
      <li
        v-for="search in line.searches"
        :key="`${search.year}-${search.office}-${search.unit}`"
        class="ddecl__search"
        data-testid="draft-declaration-search"
      >
        <!-- The spaces are for whoever reads the text rather than the
             layout (a screen reader, a copy). -->
        <span class="ddecl__year"
          ><span class="d-sr-only">wybory </span>{{ search.year }}</span
        >{{ " " }}
        <span class="ddecl__what">
          <span class="ddecl__part">{{ search.office }}</span
          >{{ " " }}
          <span class="ddecl__part" :title="search.unit">{{ search.unit }}</span
          >{{ " " }}
          <span class="ddecl__part" :title="searchState(search)">{{
            searchState(search)
          }}</span
          >{{ " " }}
          <a
            v-if="search.bipUrl"
            class="ddecl__part ddecl__bip"
            :href="search.bipUrl"
            :title="search.bipUrl"
            target="_blank"
            rel="noopener"
            data-bip-link
            ><span class="ddecl__bip-host">{{ hostOf(search.bipUrl) }}</span
            ><v-icon :icon="mdiOpenInNew" size="14" class="ddecl__bip-icon"
          /></a>
        </span>
      </li>
    </ul>

    <!-- With no crop, the links readers found by hand, and the field to give
         one: the crawl fetches them (decision on 2026-11-20). -->
    <template v-if="line.kind === 'missing'">
      <ul v-if="line.links.length > 0" class="ddecl__links">
        <li
          v-for="link in line.links"
          :key="link.url"
          class="ddecl__given"
          data-testid="draft-declaration-link"
        >
          <a
            class="ddecl__given-link"
            :href="link.url"
            target="_blank"
            rel="noopener nofollow ugc"
            >{{ shortLink(link.url)
            }}<v-icon
              :icon="mdiOpenInNew"
              size="14"
              class="ddecl__bip-icon" /></a
          >{{ " " }}
          <span class="ddecl__given-when">{{ givenText(link) }}</span>
        </li>
      </ul>
      <form
        class="ddecl__add"
        data-testid="draft-declaration-add"
        @submit.prevent="addLink"
      >
        <v-text-field
          v-model="newLink"
          class="ddecl__field"
          label="Link do oświadczenia"
          placeholder="https://bip…"
          hint="Plik albo strona BIP z oświadczeniami tej osoby"
          persistent-hint
          density="compact"
          variant="outlined"
          hide-details="auto"
          inputmode="url"
          autocomplete="off"
          :error-messages="linkError ?? undefined"
          data-link-field
        />
        <v-btn
          type="submit"
          variant="tonal"
          class="ddecl__add-go text-none"
          height="40"
          :disabled="!linkValid || sending"
          :loading="sending"
          data-link-add
        >
          Dodaj
        </v-btn>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
/** Where a draft's asset declarations on BIP stand, for a signed-in reader
 * researching the person by hand: whether one is on its way to publishing
 * the page, what holds it, or what readers read off it - and the crop
 * itself, with the whole declaration a click away. With no crop, the local
 * elections the person won since 2014 and what the crawler found for each,
 * which is where to look for the declaration by hand.
 *
 * Signed-in readers only, and only while the page is a draft (the parent
 * decides both, decision on 2026-11-20): a crop is a named person's
 * handwriting, and a public page says no more than the outcome. What an
 * admin can do about a held page is for admins. A page with nothing to say
 * says nothing. */
import { computed, ref } from "vue";
import {
  mdiFileAlertOutline,
  mdiFileClockOutline,
  mdiFileDocumentCheckOutline,
  mdiFileDocumentOutline,
  mdiFileQuestionOutline,
  mdiFileSearchOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { authRequest, useAuthState } from "~/composables/auth";
import {
  cropsLine,
  searchState,
  shortLink,
  type CropsLineKind,
} from "~/utils/personDeclarationCrops";
import { longDate, warsawDate } from "~~/shared/dates";
import {
  declarationLinkSchema,
  type PersonDeclarationCrops,
  type PersonDeclarationLink,
} from "~~/shared/declarations";

const props = defineProps<{
  nodeId: string;
  /** The page's birth date, which a settled reading is drawn against. */
  birthDate: string | null;
}>();

const { isAdmin } = useAuthState();

const { data } = useAsyncData<PersonDeclarationCrops | null>(
  `person-draft-declarations-${props.nodeId}`,
  () =>
    authRequest<PersonDeclarationCrops>(
      `/api/nodes/${props.nodeId}/declaration-crops`,
      { method: "GET" },
    ).catch(() => null),
  { server: false, lazy: true },
);

const line = computed(() => (data.value ? cropsLine(data.value) : null));

const showAll = ref(false);

/** A waiting declaration in the neutral ink, a match in the sage of the
 * public line, and what asks somebody for something in amber. */
const LOOK: Record<CropsLineKind, { icon: string; ink: string }> = {
  held: { icon: mdiFileAlertOutline, ink: "ink-warning" },
  declined: { icon: mdiFileAlertOutline, ink: "ink-neutral" },
  queued: { icon: mdiFileDocumentCheckOutline, ink: "ink-sage" },
  matched: { icon: mdiFileDocumentCheckOutline, ink: "ink-sage" },
  different: { icon: mdiFileAlertOutline, ink: "ink-warning" },
  disputed: { icon: mdiFileAlertOutline, ink: "ink-warning" },
  open: { icon: mdiFileClockOutline, ink: "ink-neutral" },
  noDate: { icon: mdiFileDocumentOutline, ink: "ink-neutral" },
  read: { icon: mdiFileDocumentOutline, ink: "ink-neutral" },
  unreadable: { icon: mdiFileQuestionOutline, ink: "ink-neutral" },
  failed: { icon: mdiFileQuestionOutline, ink: "ink-neutral" },
  missing: { icon: mdiFileSearchOutline, ink: "ink-neutral" },
};

const icon = computed(() => (line.value ? LOOK[line.value.kind].icon : ""));
const ink = computed(() => (line.value ? LOOK[line.value.kind].ink : ""));

// ---- links found by hand ----

const newLink = ref("");
const sending = ref(false);
const linkError = ref<string | null>(null);

const linkValid = computed(
  () => declarationLinkSchema.safeParse({ url: newLink.value }).success,
);

/** Sends the link, and takes the page's declarations as the answer brings
 * them, the link among them. */
async function addLink() {
  if (!linkValid.value || sending.value) return;
  sending.value = true;
  linkError.value = null;
  try {
    data.value = await authRequest<PersonDeclarationCrops>(
      `/api/nodes/${props.nodeId}/declaration-links`,
      { method: "POST", body: { url: newLink.value.trim() } },
    );
    newLink.value = "";
  } catch (error) {
    linkError.value = linkRefusal(error);
  } finally {
    sending.value = false;
  }
}

/** What to tell the reader a link was refused for: the server's own words
 * for the day's limit, and the page's for the rest. */
function linkRefusal(error: unknown): string {
  const failure = error as {
    statusCode?: unknown;
    data?: { message?: unknown } | null;
  } | null;
  const message = failure?.data?.message;
  if (failure?.statusCode === 429 && typeof message === "string") {
    return message;
  }
  if (failure?.statusCode === 400) return "To nie jest adres strony.";
  return "Nie udało się zapisać linku. Spróbuj ponownie.";
}

/** When a link was given, and whether by this reader: „dziś, przez Ciebie”,
 * „18 listopada 2026”. */
function givenText(link: PersonDeclarationLink): string {
  const instant = new Date(link.at);
  const day = isNaN(instant.getTime()) ? "" : warsawDate(instant);
  const when = !day ? "" : day === warsawDate() ? "dziś" : longDate(day, "");
  return [when, link.mine ? "przez Ciebie" : ""].filter(Boolean).join(", ");
}

/** A BIP's host, which says whose it is: „bip.swarzedz.pl”. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
</script>

<style scoped>
/* The public line's place and type: nothing above, as the facts' row ends in
   space of its own, and 24px below. As wide as a crop and its margin; the
   elections' rows take the card's width, which keeps each on one line. */
.ddecl {
  margin: 0 0 24px;
  max-width: 800px;
}

.ddecl--rows {
  max-width: none;
}

.ddecl__line {
  align-items: flex-start;
  display: flex;
  gap: 8px;
}

.ddecl__icon {
  flex: none;
  /* Centres the 18px icon on the first 20px line of text. */
  margin-top: 1px;
}

.ddecl__text {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  margin: 0;
  text-wrap: pretty;
}

.ddecl__note {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  line-height: 1.25rem;
  margin: 2px 0 0;
  text-wrap: pretty;
}

/* Under the words, not under the icon: the crops and the searches are what
   the line is about. */
.ddecl__clips {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 10px 0 0 26px;
}

.ddecl__all {
  margin: 6px 0 0 18px;
}

.ddecl__searches {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 6px 0 0 26px;
  padding: 0;
}

/* One line an election: the year, then the office, the unit, what the
   crawler found and its BIP in columns of one width on every row, so they
   line up. A unit or a verdict longer than its column ends in an ellipsis
   with the whole of it on hover; the BIP's host takes what is left. */
.ddecl__search {
  align-items: baseline;
  color: rgb(var(--v-theme-ink-neutral));
  column-gap: 12px;
  display: grid;
  font-size: 0.8125rem;
  grid-template-columns: 2.25rem minmax(0, 1fr);
  line-height: 1.25rem;
}

.ddecl__year {
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.ddecl__what {
  column-gap: 16px;
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 17rem) minmax(0, 17rem) minmax(
      0,
      1fr
    );
  white-space: nowrap;
}

.ddecl__what > * {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ddecl__bip {
  align-items: center;
  color: rgb(var(--v-theme-ink-info));
  display: inline-flex;
  font-weight: 500;
  position: relative;
  text-decoration: none;
}

.ddecl__bip-host {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* As tall as a row and its gap, 24px: any more would reach into the link of
   the row next to it. */
.ddecl__bip::before {
  content: "";
  inset: -2px -4px;
  position: absolute;
}

.ddecl__bip:hover,
.ddecl__bip:focus-visible {
  text-decoration: underline;
}

.ddecl__bip:focus-visible {
  border-radius: 2px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

.ddecl__bip-icon {
  flex: none;
  margin-inline-start: 2px;
  vertical-align: -2px;
}

.ddecl__links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 10px 0 0 26px;
  padding: 0;
}

.ddecl__given {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  gap: 0 8px;
  line-height: 1.25rem;
}

.ddecl__given-link {
  color: rgb(var(--v-theme-ink-info));
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.ddecl__given-link:hover,
.ddecl__given-link:focus-visible {
  text-decoration: underline;
}

.ddecl__given-link:focus-visible {
  border-radius: 2px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

.ddecl__given-when {
  color: rgb(var(--v-theme-ink-neutral));
}

/* The field and its button on one line, the button level with the field
   rather than with its hint. */
.ddecl__add {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  margin: 12px 0 0 26px;
  max-width: 560px;
}

.ddecl__field {
  flex: 1 1 auto;
  min-width: 0;
}

.ddecl__add-go {
  flex: none;
}

/* A phone has no width to spare beside the crops: they start under the
   icon, and a long line pans (`OswiadczeniaCrop`). */
@media (max-width: 599.98px) {
  .ddecl__clips,
  .ddecl__searches,
  .ddecl__links,
  .ddecl__add {
    margin-left: 0;
  }

  .ddecl__all {
    margin-left: -8px;
  }

  /* No room for columns: beside the year, the parts wrap as a sentence,
     a middle dot hanging off the end of each, as under a crop. */
  .ddecl__what {
    display: flex;
    flex-wrap: wrap;
    white-space: normal;
  }

  .ddecl__what > * {
    overflow: visible;
  }

  .ddecl__part:not(:last-child)::after {
    color: rgba(var(--v-theme-on-surface), 0.38);
    content: "·";
    margin: 0 6px;
  }
}
</style>

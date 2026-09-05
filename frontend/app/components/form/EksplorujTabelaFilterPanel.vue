<template>
  <div>
    <div v-if="showHeader" class="d-flex align-center mb-2">
      <span class="text-subtitle-2">Filtry</span>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        class="text-none"
        @click="emit('clear')"
      >
        Wyczyść wszystkie
      </v-btn>
    </div>

    <!-- The three public filters people actually use, in the order seven days
         of api logs put them in: teryt 43 distinct query combinations,
         category 34, currentlyEmployed 28. The other three are a click lower,
         under „Więcej filtrów”: place was used twice in that week.

         Each block is headed the way the entity page heads its groups: a small
         uppercase label with a count on the right („ZARZĄD ... 1 osoba”). The
         count here is how many of the block's filters are set, so that a panel
         opened from a shared link says which section is doing the narrowing
         before any of its controls has been read. -->
    <div class="d-flex align-center mb-1">
      <span class="text-overline text-ink-neutral">Osoba i podmiot</span>
      <v-spacer />
      <span v-if="basicCount" class="text-caption text-ink-sage">
        {{ filtersSet(basicCount) }}
      </span>
    </div>
    <v-row dense>
      <v-col cols="12" md="6">
        <v-autocomplete
          v-model="teryt"
          :items="availableRegions"
          label="Region osoby"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select
          v-model="category"
          :items="availableCategories"
          label="Typ podmiotu"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select
          v-model="currentlyEmployed"
          :items="[
            { title: 'Wszystkie osoby', value: 'all' },
            { title: 'Teraz w publicznej spółce', value: 'any' },
            { title: 'Teraz w wyszukanych podmiotach', value: 'selected' },
          ]"
          label="Zatrudnienie"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
      <!-- Up here with the public filters rather than under „Weryfikacja”,
           because the Wikipedia link is on the page for anybody to read. It is
           two searches, not one: „ludzie, o których ktoś już napisał” for a
           reader following a name they half recognise, and its opposite for an
           editor looking for the pages nobody has written up anywhere. -->
      <v-col cols="12" md="6">
        <v-select
          v-model="hasWikipedia"
          :items="wikipediaItems"
          label="Wikipedia"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
    </v-row>

    <!-- Four controls under one overline, and no prose. What stood here was a
         blue-grey sheet explaining, in three lines, that „widoczność pozwala
         na przeglądanie i weryfikację nieopublikowanych osób”; those lines
         were most of what pushed the first table row 697px down the page,
         and they wrapped the four filters the logs show are the most used on
         the site (minVotes 47 combinations, hideVoted 40, visibility 32,
         minEmploymentDate 31). The sentence survives as a tooltip. -->
    <template v-if="showVisibility">
      <v-divider class="my-4" />
      <div class="d-flex align-center ga-1 mb-2">
        <span class="text-overline text-ink-neutral">Weryfikacja</span>
        <v-tooltip
          text="Widoczność i głosy społeczności działają tylko dla zalogowanych: pozwalają przeglądać szkice i ukryć osoby, które ktoś już ocenił."
          max-width="360"
        >
          <template #activator="{ props: tooltipProps }">
            <v-icon
              v-bind="tooltipProps"
              :icon="mdiInformationOutline"
              size="small"
              class="text-ink-neutral"
            />
          </template>
        </v-tooltip>
        <v-spacer />
        <span v-if="verificationCount" class="text-caption text-ink-sage">
          {{ filtersSet(verificationCount) }}
        </span>
      </div>
      <FormEksplorujTabelaVerificationFields
        v-model:visibility="visibility"
        v-model:hide-voted="hideVoted"
        v-model:min-employment-date="minEmploymentDate"
        v-model:min-votes="minVotes"
      />
    </template>

    <!-- Opened already when the incoming link sets one of them: a filter that
         is narrowing the table from inside a collapsed section is a short
         result list with no visible reason for being short. -->
    <v-expansion-panels
      v-model="morePanel"
      variant="accordion"
      flat
      class="mt-2"
    >
      <v-expansion-panel elevation="0">
        <v-expansion-panel-title>
          <span class="text-overline text-ink-neutral">Więcej filtrów</span>
          <v-spacer />
          <!-- Was a `color="primary" variant="tonal"` chip, which paints the
               brand's pale fill as the label: #a8c79f on the white card is
               1.85:1, and this one is 10px. Text in the group's own ink,
               like the two counts above it. -->
          <span v-if="moreCount" class="text-caption text-ink-sage me-2">
            {{ filtersSet(moreCount) }}
          </span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-row dense>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="party"
                :items="availableParties"
                label="Partia"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
                multiple
                chips
                closable-chips
              >
                <!-- The chosen parties in their own colours, as the rail and
                     the table's party column draw them. `readableInkOn`
                     rather than a fixed dark label: the palette runs from
                     #f5c400 to Konfederacja's near-black navy, where black
                     ink measures 1.29:1. What that ink is measured against is
                     the declared fill, which is only what gets painted here
                     because of the `.v-field__input` rule in the style block
                     below. -->
                <template #chip="{ props: chipProps, item }">
                  <v-chip
                    v-bind="chipProps"
                    size="small"
                    variant="flat"
                    :style="partyStyle(String(item.value))"
                  >
                    {{ item.title }}
                  </v-chip>
                </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="companyTeryt"
                :items="availableRegions"
                label="Siedziba spółki"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="place"
                :items="availableCompanies"
                label="Instytucje"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
                multiple
                chips
                closable-chips
              />
            </v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-divider class="my-3" />
    <v-btn
      color="primary"
      variant="flat"
      block
      class="text-none"
      @click="emit('close')"
    >
      {{ doneLabel }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
/** Every filter of /eksploruj/tabela, as the body of the query bar's „Filtry”
 * overlay.
 *
 * Its own component because that overlay is two overlays: a 760px menu at md
 * and up, a fullscreen dialog below it, both in the DOM at once and picked by
 * a Vuetify display class rather than by a width-driven `v-if`. One set of
 * controls written twice would be two sets of controls the first time somebody
 * edited one of them.
 */

import { mdiInformationOutline } from "@mdi/js";
import { computed, ref } from "vue";
import { ink, readableInkOn, surface } from "~~/shared/colors";
import { companyCategories } from "~~/shared/companyCategories";
import { hasWikipediaOptions } from "~~/shared/queryUrl";
import { partyColors } from "~~/shared/misc";
import { polishCounting } from "~/composables/polish";
import FormEksplorujTabelaVerificationFields from "./EksplorujTabelaVerificationFields.vue";

const props = withDefaults(
  defineProps<{
    availableParties: { title: string; value: string }[] | string[];
    availableRegions: { title: string; value: string }[];
    availableCompanies: { title: string; value: string }[];
    /** The reader is signed in, so the verification filters are theirs to
     * use. */
    showVisibility?: boolean;
    /** Rows the current query returns, for the closing button. Absent on a
     * page with no table under the panel. */
    totalItems?: number;
    /** The menu draws its own „Filtry / Wyczyść wszystkie” line; the dialog
     * has a toolbar for that. */
    showHeader?: boolean;
  }>(),
  { showVisibility: true, totalItems: undefined },
);

const emit = defineEmits<{ close: []; clear: [] }>();

const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const companyTeryt = defineModel<string | null>("companyTeryt");
/** Selected employers, by place node id. */
const place = defineModel<string[] | null>("place");
const category = defineModel<string | null>("category");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");
const currentlyEmployed = defineModel<"all" | "any" | "selected">(
  "currentlyEmployed",
);
const minEmploymentDate = defineModel<string | null>("minEmploymentDate");
const minVotes = defineModel<number | null>("minVotes");
const hasWikipedia = defineModel<"all" | "yes" | "no">("hasWikipedia");

/** Built from the shared list, so the select and the chip that opens it cannot
 * end up calling the same value two things - the reason `visibilityOptions`
 * and `hideVotedOptions` are shared for the fields below. */
const wikipediaItems = hasWikipediaOptions.map((option) => ({
  title: option.title,
  value: option.value,
}));

const availableCategories = companyCategories.map((c) => ({
  title: c.title,
  value: c.value,
}));

const moreCount = computed(
  () =>
    [party.value?.length, companyTeryt.value, place.value?.length].filter(
      Boolean,
    ).length,
);

/** How many of a group's filters are narrowing the table, for the count beside
 * its heading.
 *
 * The neutral value of a select is not a filter: „Wszystkie osoby” under
 * „Zatrudnienie” is the absence of one, and counting it would put „1 filtr”
 * beside a section nobody has touched. `minVotes` is counted at 0, because the
 * api turns it into a Firestore `>=` and that drops everyone with no votes
 * field at all - it narrows more than any other value of it. */
const set = (value: string | null | undefined) => !!value && value !== "all";

const basicCount = computed(
  () =>
    [
      set(teryt.value),
      set(category.value),
      set(currentlyEmployed.value),
      set(hasWikipedia.value),
    ].filter(Boolean).length,
);

const verificationCount = computed(
  () =>
    [
      set(visibility.value),
      set(hideVoted.value),
      set(minEmploymentDate.value),
      minVotes.value !== null && minVotes.value !== undefined,
    ].filter(Boolean).length,
);

const filtersSet = (count: number) =>
  polishCounting(count, "filtr", "filtry", "filtrów");

/** A party chip in the party's own colour, and the grey of the query bar's
 * other chips for a party that has none.
 *
 * `shared/misc` leaves several of the parties it offers without a colour -
 * Razem's is commented out - and a flat chip with no background of its own
 * falls back to Vuetify's `surface-variant`, which in the light theme is
 * #424242. „Razem” in dark ink on that is 1.6:1, so the fallback is spelled
 * out rather than left to the variant. */
const partyStyle = (party: string) => {
  const fill = partyColors[party];
  return fill
    ? { backgroundColor: fill, color: readableInkOn(fill) }
    : { backgroundColor: surface.muted, color: ink.neutral };
};

/** Read once, when the overlay is first opened: after that the reader has
 * decided whether the section is open, and reopening it under them on every
 * change of a filter they can see would be the panel arguing with them. */
const morePanel = ref<number | undefined>(moreCount.value ? 0 : undefined);

const doneLabel = computed(() =>
  props.totalItems === undefined
    ? "Gotowe"
    : `Pokaż ${polishCounting(props.totalItems, "osobę", "osoby", "osób")}`,
);
</script>

<style scoped>
/* Vuetify draws the whole of `.v-field__input` at `--v-high-emphasis-opacity`,
   0.87 in the light theme, and that fades the chips inside it along with the
   text: Nowa Lewica's #D40E20 is composited to #da2d3d, and the white label
   `readableInkOn` picked for the declared fill drops from 5.41:1 to 4.75:1 -
   a quarter of a point above AA, on a chip whose text is 12px. Opacity composites
   the whole subtree, so a child cannot opt out of an ancestor's; the fade is
   lifted here and the emphasis it stood for is written into the colour
   instead, where a chip's own background is not part of it. The typed text
   goes from #3e3e3e to #212121, having been 87% black under a second 87%. */
:deep(.v-field__input) {
  opacity: 1;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}
</style>

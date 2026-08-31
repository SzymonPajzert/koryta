<template>
  <v-data-table-server
    :items-per-page="itemsPerPage"
    :page="page"
    :sort-by="sortBy"
    fixed-header
    :headers="headers"
    :items="items"
    :items-length="totalItems"
    :loading="pending"
    :items-per-page-text="itemsPerPageText"
    :items-per-page-options="itemsPerPageOptions"
    :no-data-text="noDataText"
    :loading-text="loadingText"
    :hide-default-footer="hideDefaultFooter"
    @update:page="$emit('update:page', $event)"
    @update:items-per-page="$emit('update:itemsPerPage', $event)"
    @update:sort-by="$emit('update:sortBy', $event)"
    @update:options="$emit('update:options', $event)"
  >
    <template #[`header.experience`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.latestEmploymentStart`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Firmy, w których osoba pracowała, i wybory, w których startowała. Sortowanie po dacie ostatniego zatrudnienia w publicznej spółce; w menu kolumny także po sumarycznej liczbie lat pracy."
        :column="column"
        :sort-by="sortBy"
        :sort-options="EMPLOYMENT_SORT_OPTIONS"
        @sort="sortOn"
      />
    </template>

    <template #[`header.elections`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Wybory, w których osoba startowała. Najedź na żeton, by zobaczyć miejscowość, województwo i komitet."
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.notesCount`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Liczba notatek stworzonych przez społeczność na temat powiązań tej osoby"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <!-- `header.stats.votes.interesting`, not `header.votes.interesting`:
         Vuetify looks a header slot up as `header.${column.key}`, and the key
         /eksploruj/tabela declares is `stats.votes.interesting`. Under the old
         name the slot matched no column at all, so the tooltip below was never
         on the page - the header fell through to Vuetify's default, which
         prints the title and nothing that says what the number counts. -->
    <template #[`header.stats.votes.interesting`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Suma głosów społeczności określających jak interesująca jest ta osoba. W menu kolumny można sortować także po liczbie notatek."
        :column="column"
        :sort-by="sortBy"
        :sort-options="VOTES_SORT_OPTIONS"
        @sort="sortOn"
      />
    </template>

    <template #[`header.userVote`]="{ column }">
      <ExploreTableColumnHeader
        :tooltip="userVoteTooltip"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.explore`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Wyświetla panel boczny z większą ilością informacji i opcją interakcji"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <!-- Who the person is: the name and the parties they have stood for, in
         one cell. They were two columns, which on a phone meant two ~60px
         boxes and a party ellipsised after six letters. A wrapping flex row
         gets both readings out of one rule - the chips sit beside a short
         name and drop under a long one - and the column can afford to be wide
         because there are now two of them rather than four. -->
    <template #[`item.name`]="{ item }">
      <div class="name-cell">
        <div class="d-flex flex-wrap align-center ga-1">
          <template v-if="disableFocus">
            <span class="person-name text-primary font-weight-bold">
              {{ item.name }}
            </span>
          </template>
          <template v-else>
            <!-- `text-primary cursor-pointer` is load-bearing as a locator and
                 not as a colour: seven e2e specs read `.text-primary` in the
                 first row as "the table has loaded", five of them with
                 `.cursor-pointer` on it. The stylesheet below repaints it -
                 sage as ink measures 1.85:1 on white, which is the name of
                 every person in the table at 14px. -->
            <NuxtLink
              class="person-name text-primary cursor-pointer font-weight-bold"
              @click="$emit('focus', item)"
            >
              {{ item.name }}
            </NuxtLink>
          </template>
          <!-- „szkic”, and nothing at all for the other 90-odd percent of the
               rows. This is what is left of the „Widoczność” column: a
               two-value flag whose common value is „opublikowane”, so a badge
               on every row would have been a word repeated down the whole
               table to mark the exception by its absence anyway. The same
               `x-small` chip the rest of the site marks a draft with
               (/tematy, EdgeSourcesDialog, article/SourcedEdgeList), in the
               warning pair from `shared/colors.ts` rather than in the grey
               those three take from `currentColor`: a badge that has to be
               spotted while scanning ten rows is the one place the flag is
               worth a colour, and `ink.warning` on `surface.warning` is
               5.54:1 where the `#fb8c00` this hue used to be painted with
               measured 2.37:1 as ink.
               Opt-in, because /eksploruj/nowe queues nothing but drafts and
               dropped the column for exactly that reason - every row of it
               said „Szkic”. -->
          <v-chip
            v-if="draftWithName && item.visibility === false"
            size="x-small"
            variant="flat"
            class="bg-surface-warning font-weight-medium"
          >
            szkic
          </v-chip>

          <!-- PartyChip rather than a plain `v-chip`: the same party was a
               grey pill here and its own colour on every card, drawer and
               statistics table on the site. It carries `partyColors` and the
               white-ink exceptions with it, so this is one component and not a
               second copy of that map. -->
          <PartyChip
            v-for="party in item.parties"
            :key="party"
            :party
            class="party-chip text-caption"
          />

          <!-- The „otwórz wyszukiwarki” button off the "Eksploruj" column,
               moved next to the name the searches are built out of. The
               magnifier that stood beside it did not come along: it opened the
               drawer, which is what clicking the name has always done, so a
               whole column was being spent on a second way to do one thing.
               A dark glyph and no fill behind it: blush is a fill colour and
               as an icon on the white row it measured 1.37:1, but the disc
               that fixed that made a utility action the loudest thing in the
               cell - louder than the person's name, on every row. Painted in
               `ink.neutral` (6.50:1 on white) rather than `ink.danger`, the
               only dark end the blush hue has here, which the palette spends
               on errors and removals and which would read as "this deletes
               something".
               `size="small"` where the column's copy took the default 48px,
               because this one shares a flex row with the party chips and a
               full-height button would set the height of every row.
               `density="comfortable"` on top of that, for the gap rather
               than the height: at the default density Vuetify draws an icon
               button as a circle of `--v-btn-height + 12px`, so `small`'s 28px
               became a 40px disc, and the six pixels that bought on each side
               read as distance between the glyph and the party chip beside it
               rather than as part of the button. Comfortable is
               `--v-btn-height + 0`, so the circle is the 28px the size already
               asked for and the only gap left is the row's own `ga-1`.
               `hidden-sm-and-down` rather than a `useDisplay()` test: under
               SSR Vuetify builds its display state from a placeholder 1280px
               and corrects it only when suspense resolves, so a phone would
               get the button for as long as that takes and keep it if that
               update never runs. And there is no room for it down there - the
               cell is capped at 120px and shares 343px with the history one.
               The tooltip opens after 200ms, the delay the election chips in
               the next cell already use. It was 2000 in the „Eksploruj” column
               this button came out of, where a header word said roughly what
               the column did; here it is an icon beside a person's name with
               nothing around it, and two seconds of holding still is long
               enough that nobody ever reached the one thing the tooltip has to
               say - that the click opens a dozen tabs and needs the pop-up
               blocker off. -->
          <v-tooltip
            v-if="searchWithName"
            :text="SEARCH_ALL_TOOLTIP"
            open-delay="200"
            location="top"
          >
            <template #activator="{ props: searchProps }">
              <v-btn
                v-bind="searchProps"
                :icon="mdiOpenInNew"
                variant="text"
                color="ink-neutral"
                size="small"
                density="comfortable"
                class="hidden-sm-and-down"
                @click.stop="
                  executeSearchAll(item, region, company);
                  $emit('action:explored', item);
                  if (!disableFocus) $emit('focus', item);
                "
              />
            </template>
          </v-tooltip>
        </div>

        <!-- On a one-person queue the total is what put this person in front
             of the reader, so it stays on the row - as a line under the name,
             which costs nothing, rather than as a column, which costs 32px of
             padding plus its header word. -->
        <div v-if="scoreWithName" class="text-caption text-ink-neutral">
          Suma ocen: {{ item.stats?.votes?.interesting || 0 }}
        </div>

        <!-- `v-else-if`, so that a page asking for both never prints the total
             twice on a phone. -->
        <div
          v-else-if="scoreOnPhone"
          class="text-caption text-ink-neutral d-md-none"
        >
          Suma ocen: {{ item.stats?.votes?.interesting || 0 }}
        </div>
      </div>
    </template>

    <!-- What the person has done: employers, when the most recent of them
         started, and the elections they stood in. Keyed on
         `latestEmploymentStart` rather than on a fresh `history` key, and that
         is not cosmetic - the header key is what the table emits as `sortBy`
         and `server/api/nodes/index.get.ts` hands an unrecognised one straight
         to a Firestore `orderBy`, which drops every document that lacks the
         field. A new key would empty the table on the first tap of the header
         and break the `?sortBy=latestEmploymentStart` links the QA list and
         /eksploruj/nowe already point at. -->
    <template #[`item.latestEmploymentStart`]="{ item }">
      <div class="history-cell d-flex flex-column flex-md-row ga-1 ga-md-4">
        <div
          v-if="item.companies?.length || item.latestEmploymentStart"
          class="companies-cell"
        >
          <div class="d-flex flex-wrap ga-1 py-1">
            <span v-for="companyName in item.companies" :key="companyName">
              <v-tooltip :text="shortCompanyName(companyName)" location="top">
                <template #activator="{ props: shortCompanyProps }">
                  <v-chip
                    v-bind="shortCompanyProps"
                    size="small"
                    class="mb-1 text-truncate d-flex company-chip"
                    variant="outlined"
                  >
                    {{ shortCompanyName(companyName) }}
                  </v-chip>
                </template>
              </v-tooltip>
            </span>
          </div>
          <!-- Two facts, two icons, no label. „Ostatnie zatrudnienie:” put
               twenty-one characters of prose in front of the only date in the
               cell and then joined it to the years of work with a „·”, as if
               the two were the same kind of thing - one is when the newest job
               started, the other is a total over a career. A calendar and a
               briefcase say which is which in 13px apiece, which is what
               leaves both of them on a 390px row, and the `title` carries the
               words for anybody who needs them.
               `mdiCalendarBlankOutline` is the icon card/Employment.vue
               already puts in front of an employment date, so this is the
               site's existing sign for "this is when the job ran" rather than
               a third dialect.
               The date is a pale sage pill and the career total is not, the
               way `succession/CompanyChanges.vue` writes the same two facts on
               an entity page: one is the fact the reader is scanning the
               column for, the other is context beside it. `bg-surface-sage`
               brings `ink.sage` with it (5.57:1 on that fill), where the same
               hue as ink on white is 1.85:1. -->
          <div
            v-if="employmentStartLabel(item) || experienceLabel(item)"
            class="employment-facts d-flex flex-wrap align-center ga-1 ga-md-2 text-caption"
          >
            <span
              v-if="employmentStartLabel(item)"
              class="meta-pill bg-surface-sage"
              :title="employmentStartTitle(item)"
            >
              <v-icon :icon="mdiCalendarBlankOutline" size="13" />
              {{ employmentStartLabel(item) }}
            </span>
            <span
              v-if="experienceLabel(item)"
              class="d-inline-flex align-center ga-1 text-ink-neutral"
              title="Łączny staż w publicznych spółkach"
            >
              <v-icon :icon="mdiBriefcaseOutline" size="13" />
              {{ experienceLabel(item) }}
            </span>
          </div>
        </div>

        <!-- Drawn whatever the page declares, and which copy the reader sees
             is left to a class rather than to a `v-if`: /eksploruj/tabela's
             „Wybory” column is in `headers` at every width and takes itself
             off a phone with `hidden-sm-and-down`, so a computed over that
             array answers "there is a column" below 960px too - and the chips
             were leaving the phone altogether, out of the column that is
             hidden and out of the cell that deferred to it. `d-md-none` is the
             other half of that same rule, so exactly one copy is on the page
             at any width. /eksploruj/nowe declares no such column and keeps
             this copy throughout. -->
        <ExploreTableElectionChips
          :class="{ 'd-md-none': hasElectionsColumn }"
          :elections="item.elections"
        />
      </div>
    </template>

    <!-- Elections as a column rather than as the second half of the history
         cell, which is what /eksploruj/tabela asks for above 960px: the two
         readings are „gdzie pracował” and „gdzie startował”, and a reader
         scanning for one of them was scanning the same box for both. Below
         that width the column is hidden by the page and the chips come back
         into the history cell, where there is one column to spare and not two.
         `sortable: false` on the page, and it has to stay that way: `elections`
         is not a key `server/api/nodes/index.get.ts` maps onto a Firestore
         path, so a click on it would go into `orderBy` verbatim and drop every
         document that stores the field under any other shape. -->
    <template #[`item.elections`]="{ item }">
      <ExploreTableElectionChips :elections="item.elections" />
    </template>

    <!-- No `visibility` slot any more: no page declares the column. It was the
         last of the count-style ones and a two-value flag, which is a badge
         beside the name (`draftWithName` above) rather than 142px of column
         that read „Opublikowane” on nine rows out of ten. The sort key it
         carried is untouched - it lives in `tableSortOptions` and the query
         bar's sort menu offers it to a signed-in reader. -->

    <template #[`item.notesCount`]="{ item }">
      {{ item.stats?.notesCount || 0 }}
    </template>

    <!-- Same key mismatch as the header above. The cell was falling through to
         Vuetify's own value lookup, which is right for everybody who has a
         `stats` document and blank for everybody who does not - where this
         slot reads that as the zero votes it is. -->
    <template #[`item.stats.votes.interesting`]="{ item }">
      <span class="font-weight-bold">
        {{ item.stats?.votes?.interesting || 0 }}
      </span>
      <!-- „Notatki” is one of the sorts this column's menu offers and has no
           column of its own left to be read in, so the count sits under the
           total rather than being orderable and invisible. Nothing at zero: a
           second line on every row would make the table taller to print a
           number that says what its absence already says. -->
      <div v-if="item.stats?.notesCount" class="text-caption text-ink-neutral">
        {{
          polishCounting(item.stats.notesCount, "notatka", "notatki", "notatek")
        }}
      </div>
    </template>

    <template #[`item.userVote`]="{ item }">
      <ButtonVoteNumber
        :id="item.id"
        category="interesting"
        @voted="$emit('action:voted', item)"
      />
    </template>

    <template #[`item.explore`]="{ item }">
      <div class="d-flex flex-nowrap">
        <!-- Fast here too, and the column header is not a reason to keep it
             slow: that header explains the drawer the magnifier beside this
             button opens, and says nothing about the tabs this one does. A
             warning about a browser-level side effect has to arrive before the
             click, not after two seconds of holding still.
             Painted like its copy in the name cell above, for the same reason:
             blush as an icon on white is 1.37:1, and a filled disc would put
             the loudest element of the row on a utility action. -->
        <v-tooltip :text="SEARCH_ALL_TOOLTIP" open-delay="200" location="top">
          <template #activator="{ props: searchProps }">
            <v-btn
              v-bind="searchProps"
              :icon="mdiOpenInNew"
              variant="text"
              color="ink-neutral"
              @click.stop="
                executeSearchAll(item, region, company);
                $emit('action:explored', item);
                if (!disableFocus) $emit('focus', item);
              "
            />
          </template>
        </v-tooltip>
        <!-- `ink-sage`, not `primary`: an icon has to clear 3:1 against what
             is behind it to be seen at all, and sage on white is 1.85:1 - this
             magnifier was a pale smudge on a white row. Same hue, dark enough
             to be an outline. -->
        <v-btn
          v-if="!disableFocus"
          :icon="mdiMagnify"
          variant="text"
          color="ink-sage"
          @click.stop="$emit('focus', item)"
        />
      </div>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiBriefcaseOutline,
  mdiCalendarBlankOutline,
  mdiMagnify,
  mdiOpenInNew,
} from "@mdi/js";
import {
  SEARCH_ALL_TOOLTIP,
  executeSearchAll,
} from "~/composables/usePersonSearch";
import { polishCounting } from "~/composables/polish";
import { longDate, monthYear } from "~~/shared/dates";
import { voteMeaning, voteScaleSummary } from "~/composables/votes";
import type { PersonRich } from "~~/shared/model";

/** What the arrows mean comes first, then how far they go. The scale was on
 * its own here and answered the wrong question: a reader who has never voted
 * needs to know what a plus asserts before they need to know it stops at five. */
const userVoteTooltip = [
  "Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie).",
  voteMeaning("interesting"),
  voteScaleSummary("interesting"),
]
  .filter(Boolean)
  .join(" ");

/** What each merged column may be sorted by, own key first, as its menu lists
 * it. `sentence` is read after "Sortuj wg" so it is genitive; `short` sits
 * beside the column title so it is nominative.
 *
 * Every key here is one `server/api/nodes/index.get.ts` already maps onto a
 * Firestore path, spelled exactly as it spells it. That file has no allow-list:
 * a key it does not recognise goes straight into `orderBy`, which drops every
 * document that lacks the field instead of failing, so a typo in this table
 * would answer the click with an empty table and no error anywhere.
 *
 * "Lata pracy" and "Notatki" are here rather than in the header row because
 * seven days of api logs put them at under 4% of sorted queries between them,
 * against 61 combinations for `latestEmploymentStart` and 39 for
 * `stats.votes.interesting`. They cost two columns of width for that. */
const EMPLOYMENT_SORT_OPTIONS = [
  {
    key: "latestEmploymentStart",
    sentence: "ostatniego zatrudnienia",
    short: "ostatnie zatrudnienie",
  },
  { key: "experience", sentence: "lat pracy", short: "lata pracy" },
];

const VOTES_SORT_OPTIONS = [
  { key: "stats.votes.interesting", sentence: "sumy ocen", short: "suma ocen" },
  { key: "notesCount", sentence: "liczby notatek", short: "liczba notatek" },
];

const props = withDefaults(
  defineProps<{
    items: PersonRich[];
    totalItems: number;
    pending: boolean;
    page?: number;
    itemsPerPage?: number;
    sortBy?: { key: string; order: "asc" | "desc" }[];
    headers: Record<string, unknown>[];
    noDataText?: string;
    itemsPerPageText?: string;
    itemsPerPageOptions?: { value: number; title: string }[];
    loadingText?: string;
    hideDefaultFooter?: boolean;
    region?: [string, string];
    company?: [string, string];
    disableFocus?: boolean;
    /** Print the aggregate score under the name instead of expecting a
     * `stats.votes.interesting` column.
     *
     * A per-page flag on the shared component, like `disableFocus` above,
     * because the name cell lives here and there is no pass-through slot for
     * it. /eksploruj/nowe shows one person at a time and had to drop columns
     * to fit its card, but the total is the number its queue is ordered by -
     * so it moves rather than going away. Off everywhere else, so
     * /eksploruj/tabela - which still declares the column - draws no extra
     * line. */
    scoreWithName?: boolean;
    /** Put the pink "otwórz wyszukiwarki" button inline in the name cell,
     * desktop only.
     *
     * /eksploruj/tabela dropped its "Eksploruj" column: of the two buttons in
     * it, the magnifier only opened the drawer, which is what clicking the
     * name has done all along - so a column's worth of header and padding was
     * being spent, half of it on a second way to do one thing. The half that
     * is not redundant comes back here, on the row it acts on. Off by default,
     * because /eksploruj/nowe still declares the column and would otherwise
     * draw the same button twice on one row. */
    searchWithName?: boolean;
    /** Print the aggregate score under the name below 960px only.
     *
     * Not the same flag as `scoreWithName` above and deliberately not merged
     * with it: that one is /eksploruj/nowe's, at every width, standing in for a
     * column that page does not draw at all. This one is /eksploruj/tabela's,
     * which does draw the "Oceny" column - but only above 960px, and at 390px
     * the merged column set measures 447px against a 358px viewport, putting
     * the "Oceny" header at x=363. Off screen, so the sort behind it cannot be
     * tapped and the number cannot be read; this line is where a phone gets
     * it. */
    scoreOnPhone?: boolean;
    /** Mark an unpublished person with a „szkic” badge beside their name,
     * instead of expecting a „Widoczność” column.
     *
     * Off by default and not derived from the row, because a draft is only
     * worth marking where drafts are the exception: /eksploruj/tabela shows
     * published people to everybody and drafts on top of them to a signed-in
     * reader, so the badge is news. /eksploruj/nowe queues nothing but drafts
     * - it hardcodes `visibility: "private"` - and dropped its „Widoczność”
     * column precisely because every row of it said the same word. */
    draftWithName?: boolean;
  }>(),
  {
    page: 1,
    itemsPerPage: 10,
    sortBy: () => [],
    noDataText: "Brak danych",
    itemsPerPageText: "Wierszy na stronę:",
    // Vuetify's defaults, except that the last one is labelled by its English
    // locale string ("All") - the app never sets a Polish locale.
    itemsPerPageOptions: () => [
      { value: 10, title: "10" },
      { value: 25, title: "25" },
      { value: 50, title: "50" },
      { value: 100, title: "100" },
      { value: -1, title: "Wszystkie" },
    ],
    loadingText: "Ładowanie...",
    hideDefaultFooter: false,
    disableFocus: false,
    scoreWithName: false,
    searchWithName: false,
    scoreOnPhone: false,
    draftWithName: false,
    region: undefined,
    company: undefined,
  },
);

const emit = defineEmits<{
  (e: "update:page" | "update:itemsPerPage", val: number): void;
  (e: "update:sortBy", val: { key: string; order: "asc" | "desc" }[]): void;
  (
    e: "update:options",
    val: {
      sortBy: { key: string; order: string }[];
      page: number;
      itemsPerPage: number;
    },
  ): void;
  (e: "action:explored" | "action:voted" | "focus", item: PersonRich): void;
}>();

/** What a click in a column's sort menu does. The same rule as a click on the
 * header itself, except for the direction it starts from: a header click opens
 * ascending, and none of the keys these menus offer is worth reading that way
 * round - the newest job, the most years, the most votes and the most notes are
 * all at the descending end. Picking the key that is already active flips it,
 * so the ascending order is still one more click away. */
function sortOn(key: string) {
  const current = props.sortBy[0];
  const order =
    current?.key === key && current.order === "desc" ? "asc" : "desc";
  emit("update:sortBy", [{ key, order }]);
}

const shortCompanyName = (companyName: string | undefined) => {
  if (!companyName) return "";
  const spolkaIndex = companyName.indexOf(
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  );
  if (spolkaIndex !== -1) {
    companyName =
      companyName.slice(0, spolkaIndex) + companyName.slice(spolkaIndex + 39);
  }
  return companyName;
};

/** Whether the page draws a „Wybory” column of its own, which decides which
 * copy of the chips is visible and not whether one is rendered. Read off the
 * headers the page passed rather than from a prop of its own, because a flag
 * could disagree with the column list - which would show the chips twice or
 * not at all, in a table whose other columns look right.
 *
 * It says nothing about width, and reading it as if it did is what took the
 * chips off a phone: /eksploruj/tabela declares the column at every width and
 * hides it below 960px with `hidden-sm-and-down`, so this is true down there
 * as well. All it can pick is the class that puts the chips back in the
 * history cell. */
const hasElectionsColumn = computed(() =>
  props.headers.some((header) => header.key === "elections"),
);

/** Whether the page draws a „Lata pracy” column of its own. /eksploruj/nowe
 * still does; /eksploruj/tabela folded it into the „Firmy” sort menu, and
 * that is the page whose caption below has to carry the number.
 *
 * A `v-if` off this one is exact where the same shape was wrong for the
 * elections above: this column is drawn at every width, so there is no
 * breakpoint for a header list to be blind to. */
const hasExperienceColumn = computed(() =>
  props.headers.some((header) => header.key === "experience"),
);

/** „od marca 2021”: when the person's most recent public-company job started.
 *
 * A month and a year, because the day is precision the reader cannot use -
 * this is a date to scan a column by, and the exact one is on the person's
 * page and in the drawer, both of which print the whole ISO string, which is
 * what this cell used to print too („od 2019-03-01”). Spelled out rather than
 * numbered: the numbered dialect the entity pages write - `shortDate`,
 * „01.03.2019” - is a whole day, and „03.2019” would be a spelling of a date
 * that appears nowhere else on the site.
 *
 * `monthYear` is strict about what it will read: anything that is not an ISO
 * day is printed as it arrived rather than fed to `new Date`, which answers
 * „2016” with the first of January and would put a day in the table that no
 * register ever recorded. */
function employmentStartLabel(item: PersonRich) {
  const iso = item.latestEmploymentStart;
  if (!iso) return "";
  return `od ${monthYear(iso) || iso}`;
}

/** The day behind the month the pill prints.
 *
 * The cell shows „od sierpnia 2026” because a day is more precision than a row
 * being scanned can use, but the day is the thing somebody checking a person
 * against the register needs, and until now the tooltip spent itself naming
 * the field instead - which the pill's own calendar icon already does. */
function employmentStartTitle(item: PersonRich) {
  const iso = item.latestEmploymentStart;
  if (!iso) return "";
  // Empty fallback rather than the default „brak daty”: a stored value this
  // does not recognise still prints in the cell, so a tooltip saying the date
  // is missing would contradict the row it is attached to.
  const exact = longDate(iso, "");
  return exact
    ? `Początek ostatniego zatrudnienia w publicznej spółce: ${exact}`
    : "Początek ostatniego zatrudnienia w publicznej spółce";
}

/** „11 lat pracy”: everything the person has worked in public companies.
 *
 * Rounded to whole years rather than printed with the tenth `shared/stats.ts`
 * computes, and that is two problems at once. The tenth is false precision -
 * it is derived from edge dates that are missing a day here and a month there
 * - and it is Polish this table cannot spell: `polishCounting` picks the noun
 * off the numeral, which is a rule for whole numbers, so 12.4 comes out „12,4
 * lat pracy” where the language wants „12,4 roku pracy”.
 *
 * „poniżej roku” below one, because `Math.round` would turn four months of
 * work into „0 lat pracy” - a person the table would then be claiming has
 * never worked anywhere.
 *
 * Left out entirely for a page that still draws the „Lata pracy” column -
 * /eksploruj/nowe does - which would otherwise print the same number twice on
 * one row. */
function experienceLabel(item: PersonRich) {
  if (!item.experience || hasExperienceColumn.value) return "";
  if (item.experience < 1) return "poniżej roku";
  return polishCounting(
    Math.round(item.experience),
    "rok pracy",
    "lata pracy",
    "lat pracy",
  );
}
</script>

<style scoped>
/* The name, painted. `text-primary` stays on the element because seven e2e
 * specs locate the first row by it, but the colour it names is a fill: sage
 * ink on white is 1.85:1, and this is the name of every person in the table.
 * `ink.sage` is the same hue at 6.43:1. Vuetify declares its utility colours
 * `!important`, so this has to as well; two classes plus the scope attribute
 * is what wins the tie.
 *
 * Dark ink and bold weight, and no third mark on top of them: an underline on
 * every row would be the site claiming each name is a link, and this one is
 * not - it carries no `to`, it opens the drawer. The entity pages keep the
 * underline for an address a reader can copy, so here it is kept for the
 * hover and focus below, where it answers a reader already on one name rather
 * than marking all ten. */
.person-name.text-primary {
  color: rgb(var(--v-theme-ink-sage)) !important;
}

a.person-name:hover,
a.person-name:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* PartyChip paints no fill for a party outside `partyColors` - Razem is one -
 * so without this such a person is bare text in a row of painted chips, which
 * reads as a missing value. A scoped rule reaches a child component's root. */
.party-chip {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}

/* The pale meta pill of the entity pages (`succession/CompanyChanges.vue`),
 * at the size a repeated table row can afford: 1px and 6px of padding against
 * the 2px and 8px `.now-pill` takes on a card it is drawn on once.
 * `bg-surface-sage` carries the ink with it, so nothing here sets a colour. */
.meta-pill {
  align-items: center;
  border-radius: 6px;
  display: inline-flex;
  font-weight: 600;
  gap: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}

/* Which row the pointer is on, and the last thing painting a whole row: the
 * cells also carried the sage accent edge `card/Employment.vue` puts on a
 * card, which marks one card off from the page around it and, drawn down ten
 * rows, separates nothing. It was unconditional too, in a component
 * /eksploruj/nowe mounts as well, where every other per-row mark here
 * (`draftWithName`, `searchWithName`) is an opt-in prop. This tint stays
 * because it answers the pointer: it names the one row of ten the reader is
 * on.
 *
 * Sage at 8% is under the pills rather than behind their text -
 * `surface.sage` is opaque, so the pill keeps its measured 5.57:1 whatever
 * this paints. */
:deep(tbody .v-data-table__tr:hover > .v-data-table__td) {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

/* Committee names run to "KOMITET WYBORCZY WYBORCÓW ..." and used to sit in
 * the chip, which made this the widest column on the page by a distance. It is
 * in the tooltip now, and what is left is capped so a long town name cannot do
 * the same thing again. The cap lives here rather than in
 * explore/table/ElectionChips.vue because it is a budget this table sets - the
 * same 220px whether the chips are a column of their own or the second half of
 * the history cell - and a child's root element carries the parent's scope id,
 * so the rule reaches it. */
.elections-cell {
  max-width: 220px;
}

/* The name, the party chips and (on /eksploruj/nowe) the score share this now,
 * so it can be wider than the 150px the name alone had - the column it sits in
 * is one of two rather than one of four, and the room came out of the two that
 * went. Still called `name-cell` rather than something honest like
 * `person-cell` because `tests/e2e/remove_edge.spec.ts` clicks the drawer open
 * through it. */
.name-cell {
  max-width: 200px;
}

.companies-cell {
  max-width: 300px;
}

/* Matches the cell, in pixels rather than a percentage: the chip sits in an
 * auto sized flex item, so there is nothing definite for a percentage to
 * resolve against. */
.company-chip {
  max-width: 300px;
}

/* Above the breakpoint the two halves of the history sit side by side and
 * each keeps the cap it had as a column of its own; below it they stack, which
 * is what `flex-column flex-md-row` on the cell does. No cap here on purpose -
 * the children carry theirs, and a cap on the parent would fight the gap. */
.history-cell {
  align-items: flex-start;
}

/* The page drops to two columns here (see pages/eksploruj/tabela.vue), and a
 * 375px phone leaves the table 343px to put them in: 311px of content once the
 * reduced 8px padding on four cell edges is out. A chip cannot wrap, so
 * whatever it is allowed to be wide is what its column costs at a minimum, and
 * these caps are that budget split 120/185 - they are what keeps the page off
 * a sideways scroll. It is a far kinder split than the 100/60/72/72 four
 * columns forced, which ellipsised a party after six letters. A name or a
 * company longer than its share is still truncated rather than setting the
 * width of the column for every other row - the drawer behind the name has all
 * of it in full. */
@media (max-width: 959.98px) {
  .name-cell {
    max-width: 120px;
    /* A surname long enough to not fit is broken across lines rather than
     * pushing the history column out. */
    overflow-wrap: anywhere;
  }

  /* The same 120px, on PartyChip's own root element - a scoped rule reaches a
   * child component's root, and the ellipsis that keeps a long party inside
   * this cap lives in that component. */
  .party-chip {
    max-width: 120px;
  }

  .history-cell,
  .companies-cell,
  .company-chip,
  .elections-cell {
    max-width: 185px;
  }

  /* Vuetify's 16px each side, twice over, is 64px of those 343px. Halving it
   * buys 32px back, which is a whole party chip. */
  :deep(.v-data-table__td),
  :deep(.v-data-table__th) {
    padding-inline: 8px !important;
  }
}
</style>

<template>
  <PageSection
    v-if="groups.length"
    id="listy-wyborcze"
    title="Listy wyborcze"
    :caption="caption"
    caption-testid="election-lists-caption"
    data-testid="election-lists"
  >
    <template #info>
      <p class="mb-2">
        Lista to tutaj kandydaci jednego komitetu w jednych wyborach w tym
        regionie, na wszystkie urzędy, o które ten komitet tu walczył.
        Pokazujemy osoby, które mają stronę na koryta.pl, więc lista bywa
        krótsza niż na karcie do głosowania.
      </p>
      <p class="mb-0">
        Kandydatów do rad gmin oraz na wójtów i burmistrzów zapisujemy na razie
        przy powiecie, a do Sejmu, Senatu, sejmiku i Parlamentu Europejskiego
        przy województwie, bez podziału na okręgi. Jedna lista może więc tu
        łączyć kilka list z kart do głosowania.
      </p>
    </template>

    <div :id="electionsId">
      <div
        v-for="group in shownGroups"
        :key="group.election"
        class="k-group"
        :data-testid="`election-group-${group.election}`"
      >
        <!-- Focusable only where „Pokaż starsze wybory” sends the focus: the
             first election it opens. -->
        <h3
          :id="headId(group.election)"
          class="k-group-head election-head"
          :tabindex="group.election === firstOlder ? -1 : undefined"
        >
          {{ group.title }}
          <span class="k-group-head__count">{{ rowsOf(group).length }}</span>
        </h3>
        <div :id="boxId(group.election)" class="lists-box k-bleed-xs">
          <div
            v-for="list in shownRows(group)"
            :id="`lista-${list.key}`"
            :key="list.key"
            class="list-row"
            :class="{ 'list-row--open': isOpen(list.key) }"
            :data-testid="`election-list-${list.key}`"
          >
            <button
              type="button"
              class="list-row__head"
              :aria-expanded="isOpen(list.key)"
              :aria-controls="`lista-${list.key}-osoby`"
              @click="toggle(list.key)"
            >
              <span class="list-row__text">
                <span class="list-row__name">{{ list.committee }}</span>
                <span class="list-row__meta">{{ metaOf(list) }}</span>
              </span>
              <v-icon
                :icon="isOpen(list.key) ? mdiChevronUp : mdiChevronDown"
                class="list-row__chevron"
              />
            </button>
            <RegionListMembers
              v-if="isOpen(list.key)"
              :id="`lista-${list.key}-osoby`"
              class="list-row__members"
              :members="list.members"
              :highlight-id="highlightId"
              indent
            />
          </div>
          <button
            v-if="foldedRows(group) > 0"
            type="button"
            class="list-more"
            aria-expanded="false"
            :aria-controls="boxId(group.election)"
            :data-testid="`election-lists-more-${group.election}`"
            @click="showAllLists(group)"
          >
            Pokaż wszystkie listy ({{ rowsOf(group).length }})
          </button>
        </div>
      </div>
    </div>

    <v-btn
      v-if="foldedGroups > 0"
      variant="tonal"
      class="mt-6"
      aria-expanded="false"
      :aria-controls="electionsId"
      data-testid="election-lists-older"
      @click="showOlderElections"
    >
      Pokaż starsze wybory ({{ foldedGroups }})
    </v-btn>

    <!-- Under the lists, once for all of them: the site's banner and its two
         ways in, as under a company's board. -->
    <ExploreLoginBanner
      v-if="lockedCount > 0 && !user"
      :to="loginTarget"
      :signup-to="signupTarget"
      class="mt-6 mb-0"
      data-testid="election-lists-party-teaser"
      @login="onTeaserClick('login')"
      @signup="onTeaserClick('signup')"
    >
      <div class="font-weight-bold">Powiązania polityczne po zalogowaniu</div>
      <div>
        Przy
        {{ polishCounting(lockedCount, "osobie", "osobach", "osobach") }} z tych
        list mamy niesprawdzone informacje o powiązaniach politycznych. Zaloguj
        się, by je zobaczyć.
      </div>
    </ExploreLoginBanner>
  </PageSection>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { getCurrentUser, useCurrentUser } from "vuefire";
import type { TeaserClickMode } from "~~/shared/analytics";
import { trackGoal } from "~/composables/analytics";
import { polishCounting } from "~/composables/polish";
import { teaserArrival, watchTeaserExit } from "~/composables/teaserJourney";
import type {
  CommitteeList,
  ElectionLists,
  ListMember,
} from "~~/shared/electionLists";

const props = defineProps<{
  regionId: string;
  groups: ElectionLists[];
  /** The person the reader came from, whose rows the lists mark. */
  highlightId?: string;
}>();

const route = useRoute();
const router = useRouter();
const user = useCurrentUser();

/** How many elections show before „Pokaż starsze wybory”: a województwo has
 * held candidacies in 27 of them. */
const ELECTIONS_SHOWN = 4;
/** How many lists of one election show before „Pokaż wszystkie listy”: the
 * longest first, so the fold keeps the lists with the most people. */
const LISTS_SHOWN = 6;

/** A list row, or the people of an election on no list: the same row, for
 * a committee nobody recorded. */
type Row = Pick<
  CommitteeList,
  "key" | "committee" | "members" | "offices" | "electedCount"
>;

function rowsOf(group: ElectionLists): Row[] {
  if (!group.unlisted.length) return group.lists;
  return [
    ...group.lists,
    {
      key: `${group.election}--komitet-nieznany`,
      committee: "Komitet nieznany",
      members: group.unlisted,
      offices: [],
      electedCount: group.unlisted.filter((member) => member.elected).length,
    },
  ];
}

const opened = ref(new Set<string>());
const unfolded = ref(new Set<string>());
const showAllElections = ref(false);

function isOpen(key: string): boolean {
  return opened.value.has(key);
}

function toggle(key: string) {
  const next = new Set(opened.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  opened.value = next;
}

/** The elections holding a list that is open: never folded away. */
const openElections = computed(
  () =>
    new Set(
      props.groups
        .filter((group) => rowsOf(group).some((row) => isOpen(row.key)))
        .map((group) => group.election),
    ),
);

const shownGroups = computed(() => {
  if (showAllElections.value) return props.groups;
  const lastOpen = props.groups.findLastIndex((group) =>
    openElections.value.has(group.election),
  );
  return props.groups.slice(0, Math.max(ELECTIONS_SHOWN, lastOpen + 1));
});

const foldedGroups = computed(
  () => props.groups.length - shownGroups.value.length,
);

/** The rows an election shows, folded after `LISTS_SHOWN` unless it holds an
 * open list past the fold or the reader unfolded it. Never folding a single
 * row away: the button takes about the room that row would have. */
function shownRows(group: ElectionLists): Row[] {
  const rows = rowsOf(group);
  if (unfolded.value.has(group.election) || rows.length <= LISTS_SHOWN + 1) {
    return rows;
  }
  const lastOpen = rows.findLastIndex((row) => isOpen(row.key));
  return rows.slice(0, Math.max(LISTS_SHOWN, lastOpen + 1));
}

function foldedRows(group: ElectionLists): number {
  return rowsOf(group).length - shownRows(group).length;
}

function unfoldElection(election: string) {
  unfolded.value = new Set([...unfolded.value, election]);
}

/** For the buttons to say what they open, the same on the server and in the
 * browser. An election's key („local-2024”) is fit for an id. */
const listsId = useId();
const electionsId = `${listsId}-wybory`;
function boxId(election: string): string {
  return `${listsId}-${election}`;
}
function headId(election: string): string {
  return `${listsId}-${election}-naglowek`;
}

/* Opening more takes the focused button away, which would drop a keyboard or
   screen-reader user back to the top of the page. Focus goes to the first
   thing it opened instead, as a company's „Pokaż starsze” sends it to the
   first card (succession/CompanyChanges.vue); `preventScroll`, because what
   opens, opens downwards from where the reader already is. */

/** The first list the election's fold held: its head is a button, so the
 * next Tab carries on down the lists. */
async function showAllLists(group: ElectionLists) {
  const first = rowsOf(group)[shownRows(group).length];
  unfoldElection(group.election);
  await nextTick();
  document
    .getElementById(`lista-${first?.key}`)
    ?.querySelector<HTMLElement>(".list-row__head")
    ?.focus({ preventScroll: true });
}

/** The first election the fold held, by its head, which names it. */
const firstOlder = ref<string>();
async function showOlderElections() {
  firstOlder.value = props.groups[shownGroups.value.length]?.election;
  showAllElections.value = true;
  await nextTick();
  if (firstOlder.value) {
    document
      .getElementById(headId(firstOlder.value))
      ?.focus({ preventScroll: true });
  }
}

/** „8 osób, w tym 3 z mandatem · Rada powiatu 7, Rada miasta 2”. „Z
 * mandatem” rather than „wybranych”, which would have to agree in gender
 * with people it does not name. The offices only where the list stood for
 * more than one: a list of one office says it in its members' rows. */
function metaOf(row: Row): string {
  const people = polishCounting(row.members.length, "osoba", "osoby", "osób");
  const won = row.electedCount ? `, w tym ${row.electedCount} z mandatem` : "";
  const offices =
    row.offices.length > 1
      ? ` · ${row.offices.map(({ office, count }) => `${office} ${count}`).join(", ")}`
      : row.offices.length === 1
        ? ` · ${row.offices[0]!.office}`
        : "";
  return `${people}${won}${offices}`;
}

const people = computed(() => {
  const byId = new Map<string, ListMember>();
  for (const group of props.groups) {
    for (const row of rowsOf(group)) {
      for (const member of row.members) byId.set(member.personId, member);
    }
  }
  return [...byId.values()];
});

/** „39 list · 89 osób” beside the head. */
const caption = computed(() => {
  if (!props.groups.length) return undefined;
  const lists = props.groups.reduce(
    (sum, group) => sum + group.lists.length,
    0,
  );
  return `${polishCounting(lists, "lista", "listy", "list")} · ${polishCounting(
    people.value.length,
    "osoba",
    "osoby",
    "osób",
  )}`;
});

/** A list a link points at (`#lista-…`, from the box at the top of the page,
 * or a link somebody shared) opens, and its election unfolds, before the
 * browser looks for it. After mounting: the server never sees the hash, and
 * opening the list during hydration would draw a page its html does not
 * match. */
async function openFromHash(hash: string | undefined) {
  const key = hash?.startsWith("#lista-") ? hash.slice(7) : "";
  const group = props.groups.find((each) =>
    rowsOf(each).some((row) => row.key === key),
  );
  if (!group) return;
  opened.value = new Set([...opened.value, key]);
  unfoldElection(group.election);
  showAllElections.value ||= !shownGroups.value.includes(group);
  await nextTick();
  document
    .getElementById(`lista-${key}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- the hidden parties, as under a company's board ---------- */

/** Unpublished candidates with a party this reader is not shown. */
const lockedCount = computed(
  () => people.value.filter((member) => member.partyHidden).length,
);

// Back to the page without its hash: the server never sees one, and Vue
// keeps the server's href when it hydrates, so a link opened in a new tab
// and a click would otherwise return to two different places.
const loginTarget = computed(() => ({
  path: "/login",
  query: {
    redirect: route.fullPath.replace(/#.*/, ""),
    powod: "partie-na-listach",
  },
}));
const signupTarget = computed(() => ({
  path: "/login",
  query: { ...loginTarget.value.query, konto: "nowe" },
}));

const TEASER_GOAL = { surface: "region", kind: "partia" } as const;

function onTeaserClick(mode: TeaserClickMode) {
  trackGoal("teaser:click", { ...TEASER_GOAL, mode });
}

let teaserReported = false;
let stopWatchingExit: (() => void) | undefined;

/** `teaser:shown`, once, when the lists first show a logged out reader a
 * party they hold back - as `SuccessionCompanyChanges` reports its board. */
async function reportTeaser() {
  if (teaserReported || lockedCount.value === 0) return;
  teaserReported = true;
  if (await getCurrentUser()) return;
  trackGoal("teaser:shown", {
    ...TEASER_GOAL,
    from: teaserArrival(props.regionId),
  });
  stopWatchingExit = watchTeaserExit(router, route.path, TEASER_GOAL);
}

onMounted(() => {
  watch(() => route.hash, openFromHash, { immediate: true });
  watch(lockedCount, reportTeaser, { immediate: true });
});
onBeforeUnmount(() => stopWatchingExit?.());
</script>

<style scoped>
/* Focus only lands on an election's head from „Pokaż starsze wybory”, as a
   reading position, not a control. */
.election-head:focus {
  outline: none;
}

.list-row {
  background: rgb(var(--v-theme-surface));
  /* A link from the box at the top lands here clear of the sticky bar. */
  scroll-margin-top: 88px;
}

.list-row + .list-row {
  border-top: 1px solid var(--k-line);
}

/* The whole head is the button: the committee's name, what the list holds,
   and the chevron at the row's end. */
.list-row__head {
  align-items: center;
  color: inherit;
  cursor: pointer;
  display: flex;
  gap: 12px;
  min-height: 56px;
  padding: 10px 16px;
  text-align: left;
  width: 100%;
}

/* The sage hover edge of the history's rows, drawn inside the row. */
@media (hover: hover) {
  .list-row__head:hover {
    box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.9);
  }
}

.list-row__head:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-neutral));
  outline-offset: -2px;
}

.list-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.list-row__name {
  font-size: var(--k-ui-size);
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.list-row__meta {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.4;
}

.list-row__chevron {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  flex: none;
}

/* The open list's people under its head, a step in from it so they read as
   the head's and not as more lists - by their place, not a tint: a new grey
   surface would be a colour decision, and those wait for the palette. */
.list-row__members {
  border-top: 1px solid var(--k-line);
}
</style>

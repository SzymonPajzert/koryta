<template>
  <section data-testid="company-successions">
    <div v-if="loading" class="text-center py-8">
      <v-progress-circular indeterminate />
    </div>

    <div
      v-else-if="failed"
      class="k-note text-caption text-medium-emphasis d-flex align-center ga-2"
      data-testid="successions-error"
    >
      <v-icon :icon="mdiAlertCircleOutline" size="15" />
      <span>Nie udało się wczytać zmian kadrowych. Odśwież stronę.</span>
    </div>

    <!-- Nothing at all: one sentence rather than two headings over empty
         space, which reads as a page that failed to load. -->
    <div
      v-else-if="nothingToShow"
      class="k-note text-caption text-medium-emphasis d-flex align-start ga-2"
      data-testid="successions-empty"
    >
      <v-icon :icon="mdiEyeOffOutline" size="15" class="mt-1" />
      <span>
        Nie mamy wpisów kadencyjnych dla: {{ companyName }}. Kiedy rejestr poda
        daty powołania i odwołania, pojawi się tu obecny skład i to, kto kogo
        zastąpił.
      </span>
    </div>

    <template v-else>
      <!-- ============ 1. obecny skład ============ -->
      <section class="mb-8" data-testid="successions-current">
        <div class="sec-head mb-1">
          <h2 class="text-h6 font-weight-bold">Obecny skład</h2>
          <span class="text-caption text-medium-emphasis">
            wpisy bez daty zakończenia, stan na {{ longDate(today) }}
          </span>
        </div>

        <div
          v-for="group in currentGroups"
          :key="group.key"
          class="mt-4"
          :data-testid="`current-role-${group.key}`"
        >
          <div class="role-head">
            <v-icon :icon="mdiOfficeBuildingOutline" size="15" />{{ group.role
            }}<span class="count">{{
              count(group.people.length, "osoba", "osoby", "osób")
            }}</span>
          </div>

          <v-row dense>
            <v-col
              v-for="{ post, predecessor } in group.people"
              :key="post.edgeId"
              cols="12"
              md="6"
            >
              <div class="k-card k-card--accent pa-4 pl-5 h-100">
                <div class="d-flex align-start ga-3">
                  <div class="av av--in">{{ initials(post.personName) }}</div>
                  <div class="flex-grow-1 rl-txt">
                    <div class="d-flex align-center flex-wrap ga-2">
                      <NuxtLink
                        :to="personUrl(post)"
                        class="link-plain text-subtitle-1 font-weight-bold"
                        >{{ post.personName }}</NuxtLink
                      >
                      <PartyChip
                        v-for="party in post.parties"
                        :key="party"
                        :party
                      />
                    </div>

                    <div class="d-flex align-center flex-wrap ga-2 mt-2">
                      <span class="now-pill">
                        <v-icon :icon="mdiCalendarBlankOutline" size="13" />
                        {{
                          post.start
                            ? `od ${longDate(post.start)}`
                            : "bez daty powołania"
                        }}
                      </span>
                      <span
                        v-if="duration(post.start, null)"
                        class="text-caption text-medium-emphasis"
                      >
                        {{ duration(post.start, null) }} na stanowisku
                      </span>
                    </div>

                    <div
                      v-if="predecessor"
                      class="text-caption text-medium-emphasis mt-2 d-flex align-center flex-wrap ga-1"
                    >
                      <v-icon :icon="mdiSwapVertical" size="14" />
                      <span>wcześniej na tym stanowisku:</span>
                      <span
                        v-if="predecessor.batchSize > 1"
                        :title="batchNote(predecessor.batchSize)"
                        >m.in.</span
                      >
                      <NuxtLink
                        :to="personUrl(predecessor)"
                        class="link-plain font-weight-medium"
                        >{{ predecessor.personName }}</NuxtLink
                      >
                      <PartyChip
                        v-for="party in predecessor.parties"
                        :key="party"
                        :party
                      />
                    </div>
                  </div>
                </div>
              </div>
            </v-col>
          </v-row>
        </div>

        <div
          v-if="!currentGroups.length"
          class="k-note text-caption text-medium-emphasis d-flex align-start ga-2 mt-4"
          data-testid="current-empty"
        >
          <v-icon :icon="mdiEyeOffOutline" size="15" class="mt-1" />
          <!-- Two reasons, and the section cannot tell them apart: the
               endpoint drops a post whose holder has no page without counting
               it, the way the rest of the site does. -->
          <span>
            Nie mamy tu nikogo z otwartym wpisem: albo każdy wpis, który znamy,
            ma już datę zakończenia, albo brakuje strony osoby, która zajmuje
            stanowisko.
          </span>
        </div>
      </section>

      <!-- ============ 2. kto kogo zastąpił ============ -->
      <section data-testid="successions-relay">
        <div class="sec-head mb-1">
          <h2 class="text-h6 font-weight-bold">Kto kogo zastąpił</h2>
          <span
            v-if="successions.length"
            class="text-caption text-medium-emphasis"
            data-testid="successions-count"
          >
            {{ count(successions.length, "zmiana", "zmiany", "zmian") }} w
            {{
              count(roleSections.length, "funkcji", "funkcjach", "funkcjach")
            }}
          </span>
        </div>
        <p class="text-caption text-medium-emphasis mb-6 relay-intro">
          Pary dobrane 1:1 w obrębie tej spółki i tej samej funkcji: koniec
          jednego wpisu i początek kolejnego w oknie od
          {{ MAX_OVERLAP_DAYS }} dni przed do {{ MAX_GAP_DAYS }} dni po. Wpisy z
          tego samego dnia zebrano w jedno zdarzenie.
        </p>

        <div
          v-for="section in roleSections"
          :key="section.key"
          class="mb-8"
          :data-testid="`succession-role-${section.key}`"
        >
          <div class="role-head">
            <v-icon :icon="mdiOfficeBuildingOutline" size="15" />{{
              section.role
            }}<span class="count">{{
              count(section.count, "zmiana", "zmiany", "zmian")
            }}</span>
          </div>
          <div class="rl-legend">
            <span>Ustępuje</span><span /><span>Obejmuje stanowisko</span>
          </div>

          <div
            v-for="batch in section.batches"
            :key="batch.key"
            class="k-card k-card--accent mb-3"
            :class="{ 'ev--batch': batch.pairs.length > 1 }"
            data-testid="succession-batch"
          >
            <div class="ev-head">
              <span class="ev-date">{{
                batch.date ? longDate(batch.date) : "Bez daty w rejestrze"
              }}</span>
              <span
                v-if="batch.pairs.length > 1"
                class="ev-badge"
                data-testid="batch-count"
              >
                {{ count(batch.pairs.length, "zmiana", "zmiany", "zmian") }}
                tego samego dnia
              </span>
              <span
                v-if="batch.pairs.length > 1 && batch.tally.length"
                class="ev-sub"
                data-testid="batch-parties"
              >
                wśród ustępujących: {{ batch.tally.join(", ") }}
              </span>
            </div>

            <div class="ev-body">
              <div
                v-for="pair in batch.pairs"
                :key="`${pair.left.edgeId}-${pair.joined.edgeId}`"
                class="rl-row"
                data-testid="succession-row"
              >
                <div class="rl-left">
                  <div class="rl-ovl">Ustępuje</div>
                  <div class="rl-p">
                    <div class="av av--out">
                      {{ initials(pair.left.personName) }}
                    </div>
                    <div class="rl-txt">
                      <div class="rl-names">
                        <NuxtLink
                          :to="personUrl(pair.left)"
                          class="link-plain rl-name"
                          >{{ pair.left.personName }}</NuxtLink
                        >
                        <PartyChip
                          v-for="party in pair.left.parties"
                          :key="party"
                          :party
                        />
                      </div>
                      <div class="rl-meta">{{ spell(pair.left) }}</div>
                    </div>
                  </div>
                </div>

                <div class="rl-mid">
                  <div class="rl-disc">
                    <span class="arrow-h"
                      ><v-icon :icon="mdiArrowRight" size="17"
                    /></span>
                    <span class="arrow-v"
                      ><v-icon :icon="mdiArrowDown" size="17"
                    /></span>
                  </div>
                  <div class="rl-gap">{{ gapLabel(pair.gapDays) }}</div>
                  <div v-if="switchesParty(pair)" class="rl-flip">
                    zmiana afiliacji
                  </div>
                </div>

                <div class="rl-right">
                  <div class="rl-ovl">Obejmuje stanowisko</div>
                  <div class="rl-p">
                    <div class="av av--in">
                      {{ initials(pair.joined.personName) }}
                    </div>
                    <div class="rl-txt">
                      <div class="rl-names">
                        <NuxtLink
                          :to="personUrl(pair.joined)"
                          class="link-plain rl-name"
                          >{{ pair.joined.personName }}</NuxtLink
                        >
                        <PartyChip
                          v-for="party in pair.joined.parties"
                          :key="party"
                          :party
                        />
                      </div>
                      <div class="rl-meta">{{ spell(pair.joined) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="!successions.length"
          class="k-note text-caption text-medium-emphasis d-flex align-start ga-2"
          data-testid="successions-none"
        >
          <v-icon :icon="mdiEyeOffOutline" size="15" class="mt-1" />
          <span>
            Nie dopasowaliśmy tu żadnej zmiany: wpisy, które znamy, nie mają
            dat, albo nikt nie objął stanowiska w oknie
            {{ MAX_GAP_DAYS }} dni od jego zwolnienia.
          </span>
        </div>

        <!-- Why the section is shorter than the register. Said out loud: a
             section showing two of fifteen handovers reads as a bug. -->
        <div
          v-if="hidden"
          class="k-note text-caption text-medium-emphasis d-flex align-start ga-2"
          data-testid="successions-hidden"
        >
          <v-icon :icon="mdiEyeOffOutline" size="15" class="mt-1" />
          <span>
            Nie pokazujemy {{ count(hidden, "zmiany", "zmian", "zmian") }} —
            brakuje strony jednej z osób. W zestawieniu są tylko te zmiany, w
            których obie osoby mają u nas swoją stronę.
          </span>
        </div>
      </section>
    </template>
  </section>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiArrowDown,
  mdiArrowRight,
  mdiCalendarBlankOutline,
  mdiEyeOffOutline,
  mdiOfficeBuildingOutline,
  mdiSwapVertical,
} from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import { createSlug, generateEntityUrl } from "~/composables/slugs";
import { gapLabel, MAX_GAP_DAYS, MAX_OVERLAP_DAYS } from "~~/shared/succession";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "~~/server/api/edges/successions.get";

const props = defineProps<{ companyId: string; companyName: string }>();

/** The two roles the register fills at almost every company, in the order a
 * reader looks for them. Everything else - prokurent, likwidator, a role
 * somebody typed by hand - sorts alphabetically after them. Matched on the
 * lowercased name, the way `shared/succession.ts` matches a seat. */
const ROLE_ORDER = ["zarząd", "rada nadzorcza"];

/** What a role with no name is called on screen. The pairing drops spells
 * whose role nobody recorded, so this only ever labels a current post. */
const NO_ROLE = "Funkcja niepodana w rejestrze";

const route = useRoute();
// See `usePersonSuccessions`: the current user, not the whole auth state,
// which would open a Firestore subscription this never reads.
const user = useCurrentUser();

/** `latest` put in the query rather than left to `authFetch`, which adds it in
 * an `onRequest` that returns early on the server - so the SSR request goes
 * out anonymous and `useFetch`, already holding that answer, never repeats it
 * in the browser. See `usePersonSuccessions`, which says it at length. */
const query = computed(() => ({
  companyId: props.companyId,
  ...(user.value || route.query.latest !== undefined
    ? { latest: route.query.latest ?? true }
    : {}),
}));

// Not awaited. Nuxt settles `useAsyncData` before it serialises the page, so
// this is still server rendered; awaiting would hold a client-side navigation
// into a company page on this one section.
const { data, status } = authFetch<CompanySuccessions>(
  "/api/edges/successions",
  {
    query,
    // Named after the company rather than left to key on the url, so two
    // companies do not abort each other's request. `place/DetailView.vue`
    // remounts this component per node, so the id is fixed for its lifetime.
    key: `company-successions-${props.companyId}`,
  },
);

const failed = computed(() => status.value === "error");
const loading = computed(() => !failed.value && !data.value);

const successions = computed<Succession[]>(() => data.value?.successions ?? []);
const current = computed<CurrentPost[]>(() => data.value?.current ?? []);
const hidden = computed(() => data.value?.hidden ?? 0);
const nothingToShow = computed(
  () => !successions.value.length && !current.value.length && !hidden.value,
);

/** Today, fixed at render and carried into the browser in the payload, so the
 * server and the client cannot disagree about what "stan na" says. Local
 * components rather than `toISOString`, which would answer yesterday for the
 * first two hours of a Warsaw day. */
const today = useState("succession-today", () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});

/* ---------- dates ---------- */

// `timeZone: "UTC"` against a date built with `Date.UTC`: a register day is a
// day, not an instant, and left to the local zone a browser west of Greenwich
// would render every one of them as the day before.
const LONG_DATE = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const SHORT_DATE = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** The three numbers in an ISO day, or null for anything else.
 *
 * Same strictness as `spellDate` in `shared/succession.ts`, and for the same
 * reason: `new Date("2016")` answers 1 January, which would print a date the
 * register never recorded. */
function parts(iso: string | null | undefined) {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function longDate(iso: string | null | undefined): string {
  const part = parts(iso);
  if (!part) return "brak daty";
  return LONG_DATE.format(new Date(Date.UTC(part.y, part.m - 1, part.d)));
}

function shortDate(iso: string | null | undefined): string {
  const part = parts(iso);
  if (!part) return "brak daty";
  return SHORT_DATE.format(new Date(Date.UTC(part.y, part.m - 1, part.d)));
}

/** 1 / 2-4 / 5+, with the 12-14 exception Polish keeps for itself. */
function pluralPl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function count(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralPl(n, one, few, many)}`;
}

/** How long a spell ran, in years and months. An open spell is measured to
 * today, which is what "2 lata na stanowisku" means on a current post. */
function duration(start: string | null, end: string | null): string {
  const from = parts(start);
  const to = parts(end) ?? parts(today.value);
  if (!from || !to) return "";
  let months = (to.y - from.y) * 12 + (to.m - from.m);
  if (to.d < from.d) months -= 1;
  if (months < 1) return "poniżej miesiąca";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} mies.`;
  const label = pluralPl(years, "rok", "lata", "lat");
  return `${years} ${label}${rest ? ` ${rest} mies.` : ""}`;
}

/** The whole spell behind one side of a handover, so a row stands on its own
 * rather than only naming the day the seat changed hands. */
function spell(side: SuccessionSide): string {
  if (!side.start) return "brak daty rozpoczęcia";
  const end = side.end ? shortDate(side.end) : "obecnie";
  const length = duration(side.start, side.end);
  return `${shortDate(side.start)} – ${end}${length ? ` · ${length}` : ""}`;
}

/* ---------- people ---------- */

/** Stands in for a photograph nobody has, as on `card/Employment.vue`. */
function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function personUrl(who: { personId: string; personName: string }): string {
  return generateEntityUrl("person", who.personId, who.personName);
}

/** Whether the seat changed party with its holder. Only claimed when both
 * sides are known: an empty `parties` means "not recorded", not
 * "bezpartyjny", and reading it as a swing would invent one. */
function switchesParty(pair: Succession): boolean {
  const left = pair.left.parties;
  const joined = pair.joined.parties;
  return left.length > 0 && joined.length > 0 && left[0] !== joined[0];
}

/* ---------- grouping ---------- */

function roleKey(role: string | null): string {
  return role?.trim().toLowerCase() ?? "";
}

function roleRank(key: string): number {
  const at = ROLE_ORDER.indexOf(key);
  return at < 0 ? ROLE_ORDER.length : at;
}

/** Zarząd, Rada Nadzorcza, then whatever else the register holds, in Polish
 * collation. */
function byRole<T>(groups: Map<string, { role: string; items: T[] }>) {
  return [...groups.entries()]
    .sort(
      ([a, ga], [b, gb]) =>
        roleRank(a) - roleRank(b) || ga.role.localeCompare(gb.role, "pl"),
    )
    .map(([key, group]) => ({
      // Slugged rather than raw: a `data-testid` carrying a space and an ę is
      // a selector every test has to quote.
      key: createSlug(key) || "bez-funkcji",
      role: group.role,
      items: group.items,
    }));
}

/** Open posts by role, longest-serving first. A post with no start date sorts
 * last rather than reading as the oldest one there.
 *
 * Each one carries whoever the handover put out of that seat, matched on the
 * arriving edge: it is the same fact as a row of the relay below, said where a
 * reader looking at today's board is standing.
 */
/** Why a predecessor is hedged, for whoever hovers it. */
function batchNote(batchSize: number): string {
  return (
    `Tego dnia zmieniło się ${batchSize} stanowisk tej samej funkcji. ` +
    "Rejestr nie wskazuje, kto zajął czyje miejsce."
  );
}

const currentGroups = computed(() => {
  // Carrying the batch with the person: a seat that changed hands on a day when
  // three others did is one the register cannot say who took from whom, and the
  // line below has to hedge rather than name somebody flatly.
  const predecessors = new Map(
    successions.value.map((s) => [
      s.joined.edgeId,
      { ...s.left, batchSize: s.batchSize },
    ]),
  );
  const groups = new Map<string, { role: string; items: CurrentPost[] }>();
  for (const post of current.value) {
    const key = roleKey(post.role);
    const group = groups.get(key);
    if (group) group.items.push(post);
    else groups.set(key, { role: post.role?.trim() || NO_ROLE, items: [post] });
  }
  return byRole(groups).map((group) => ({
    ...group,
    people: group.items
      .sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"))
      .map((post) => ({
        post,
        predecessor: predecessors.get(post.edgeId) ?? null,
      })),
  }));
});

type Batch = {
  key: string;
  date: string | null;
  pairs: Succession[];
  /** "3 × PiS", the parties among the people leaving on this day. */
  tally: string[];
};

/** The relay: role, then handover date.
 *
 * The date grouping is the point. The register files a board turnover as one
 * decision - seven struck off and seven entered on one morning - and seven
 * separate cards would tell a reader it happened seven times. A handover with
 * no date is left on its own: those share nothing but the gap in the data, and
 * a "4 zmiany tego samego dnia" badge over them would be a claim about a day
 * nobody recorded.
 */
const roleSections = computed(() => {
  const groups = new Map<string, { role: string; items: Succession[] }>();
  for (const succession of successions.value) {
    const key = roleKey(succession.role);
    const group = groups.get(key);
    if (group) group.items.push(succession);
    else
      groups.set(key, {
        role: succession.role.trim() || NO_ROLE,
        items: [succession],
      });
  }

  return byRole(groups).map((group) => {
    const ordered = [...group.items].sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") ||
        a.joined.edgeId.localeCompare(b.joined.edgeId),
    );

    const batches: Batch[] = [];
    for (const succession of ordered) {
      const last = batches[batches.length - 1];
      if (last && succession.date && last.date === succession.date) {
        last.pairs.push(succession);
      } else {
        batches.push({
          key: `${succession.date ?? "brak"}-${succession.joined.edgeId}`,
          date: succession.date,
          pairs: [succession],
          tally: [],
        });
      }
    }

    for (const batch of batches) {
      const tally = new Map<string, number>();
      for (const pair of batch.pairs) {
        for (const party of pair.left.parties) {
          tally.set(party, (tally.get(party) ?? 0) + 1);
        }
      }
      batch.tally = [...tally.entries()]
        .sort(([pa, na], [pb, nb]) => nb - na || pa.localeCompare(pb, "pl"))
        .map(([party, n]) => `${n} × ${party}`);
    }

    return { key: group.key, role: group.role, count: ordered.length, batches };
  });
});
</script>

<style scoped>
/* `k-card`, `k-card--accent` and `k-note` are global (`app.vue`), and so is
   `sec-head`. They used to be here too, at values a little off the ones
   `succession/PersonChanges.vue` carried - 8px round instead of 10, a 4px
   full-height rail instead of a 3px inset one, a baseline-aligned heading
   instead of a centred one. Nobody chose that; they were copied at different
   times. The company page moves to the shared values, which is what lets the
   notes underneath these cards be the same object as the cards themselves.
   The two headings keep their 6px of air as a `mb-1`, rounded to the spacing
   scale, because the shell puts that gap on the lead paragraph and these two
   have none. */

.relay-intro {
  max-width: 62ch;
}

.role-head {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.16);
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 8px;
  letter-spacing: 0.09em;
  margin-bottom: 12px;
  padding-bottom: 6px;
  text-transform: uppercase;
}

.role-head .count {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-weight: 400;
  letter-spacing: 0;
  margin-left: auto;
  text-transform: none;
}

/* ---- obecny skład ---- */

/* Sage behind ink rather than as ink: the one thing a reader scanning the
   section is looking for is who is in the seat now. */
.now-pill {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}

/* ---- the relay ---- */

.ev-head {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.16);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 16px 10px 20px;
}

/* One sage strip over a batch: the rows below it are one decision. */
.ev--batch .ev-head {
  background: rgba(var(--v-theme-primary), 0.22);
}

.ev-date {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.95rem;
  font-weight: 700;
}

.ev-badge {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 9px;
  white-space: nowrap;
}

.ev-sub {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.72rem;
  margin-left: auto;
}

.rl-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 184px 1fr;
  padding: 12px 16px 12px 20px;
}

.rl-row + .rl-row {
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
}

.rl-p {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

/* The two avatars flank the arrow, so the baton changes hands in the middle
   of the row instead of at its edges. */
.rl-left .rl-p {
  flex-direction: row-reverse;
  text-align: right;
}

.rl-left .rl-names {
  justify-content: flex-end;
}

/* Without this the flex item is free to size to its longest word, and an
   unbroken surname widens the row past the card. */
.rl-txt {
  min-width: 0;
}

.rl-names {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  line-height: 1.25;
}

.rl-name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.875rem;
  font-weight: 700;
}

.rl-meta {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.72rem;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Which side of the handover a block is, on the phone layout only: on a wide
   row the legend above the cards says it once for the whole role. */
.rl-ovl {
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: none;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin-bottom: 2px;
  text-transform: uppercase;
}

.av {
  border-radius: 50%;
  display: grid;
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 700;
  height: 34px;
  place-items: center;
  width: 34px;
}

/* Faded = the post was left; sage = the post is now theirs. */
.av--out {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.av--in {
  background: rgb(var(--v-theme-primary));
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.rl-mid {
  align-items: center;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
}

/* One thread down the whole batch, beaded by the arrows: four rows, one
   decision. Drawn on the body, or it breaks at every row gap. */
.ev-body {
  position: relative;
}

.ev--batch .ev-body::before {
  background: rgba(var(--v-border-color), 0.3);
  bottom: 8px;
  content: "";
  left: calc(50% + 2px);
  position: absolute;
  top: 8px;
  width: 1px;
}

.rl-disc {
  padding: 3px 0;
}

.rl-disc span {
  background: rgba(var(--v-theme-primary), 0.28);
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: grid;
  height: 26px;
  place-items: center;
  width: 26px;
}

/* Opaque, so the thread runs behind the beads and not through the words. */
.rl-gap {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.7rem;
  line-height: 1.3;
  padding: 0 4px;
  position: relative;
  text-align: center;
}

.rl-flip {
  background: rgb(var(--v-theme-secondary));
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 8px;
  position: relative;
  white-space: nowrap;
}

.rl-disc .arrow-v {
  display: none;
}

/* Column labels once per role, not once per card. */
.rl-legend {
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: grid;
  font-size: 0.62rem;
  font-weight: 700;
  gap: 10px;
  grid-template-columns: 1fr 184px 1fr;
  letter-spacing: 0.1em;
  padding: 0 17px 8px 21px;
  text-transform: uppercase;
}

.rl-legend > :first-child {
  text-align: right;
}

/* ---- phone: the relay reflows to a baton, never a scroller ---- */
@media (max-width: 719px) {
  .rl-row {
    gap: 0;
    grid-template-columns: 1fr;
    padding: 14px 14px 14px 18px;
  }

  .rl-left .rl-p {
    flex-direction: row;
    text-align: left;
  }

  .rl-left .rl-names {
    justify-content: flex-start;
  }

  /* Indented to the name column so the thread below has a clear channel down
     the avatars. */
  .rl-ovl {
    display: block;
    padding-left: 44px;
  }

  .rl-meta {
    white-space: normal;
  }

  .rl-mid {
    flex-direction: row;
    gap: 10px;
    justify-content: flex-start;
    margin: 6px 0 6px 4px;
    position: relative;
  }

  .rl-mid::before {
    background: rgba(var(--v-border-color), 0.3);
    bottom: -20px;
    content: "";
    left: 13px;
    position: absolute;
    top: -8px;
    width: 1px;
  }

  .rl-disc {
    padding: 0;
  }

  .rl-disc .arrow-h {
    display: none;
  }

  .rl-disc .arrow-v {
    display: grid;
  }

  .rl-legend,
  .ev--batch .ev-body::before {
    display: none;
  }

  .ev-sub {
    margin-left: 0;
    width: 100%;
  }
}
</style>

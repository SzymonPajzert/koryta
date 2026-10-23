<template>
  <div
    v-if="part === 'current' && loading"
    class="text-center py-8"
    data-testid="successions-loading"
  >
    <!-- One of three parts of the company page, picked by `part`, all off
         the page's one request. A part with nothing to show renders nothing
         at all - no heading over a note that the heading is empty - and what
         it would have said goes into the `absent` part's one line.

         The comments go inside the branches, not between them: in a dev
         build a comment there joins the next branch as a fragment, and the
         class the page passes in never reaches the element. -->
    <v-progress-circular indeterminate />
  </div>

  <div
    v-else-if="part === 'current' && failed"
    class="k-note k-absent d-flex align-center ga-2"
    data-testid="successions-error"
  >
    <!-- The quiet line of what a section lacks (`k-absent`), with the alert
         icon that tells a failure from an absence: two sentences of prose,
         at the UI size rather than the 12px of meta. -->
    <v-icon :icon="mdiAlertCircleOutline" size="15" />
    <span>Nie udało się wczytać zmian kadrowych. Odśwież stronę.</span>
  </div>

  <p
    v-else-if="part === 'absent' && ready && absentLine"
    class="k-note k-absent"
    data-testid="company-absent"
  >
    <!-- What the page does not have, in one quiet line after the people -
         the same line a person's page gives what it withholds - and the
         sentences that used to stand in each empty section behind its (i):
         hidden, not deleted. The page sets it 12px under the history, as
         a person's sits under theirs. -->
    {{ absentHead }}
    <!-- The last word and the (i) as one unbreakable piece. -->
    <span class="k-absent__tail"
      >{{ absentTail }}
      <InfoBubble label="Czego tu brakuje">
        <span
          v-for="item in absentInfo"
          :key="item.testid"
          class="d-block why"
          :data-testid="item.testid"
        >
          <strong>{{ item.title }}.</strong> {{ nbsp(item.text) }}
        </span>
      </InfoBubble></span
    >
  </p>

  <PageSection
    v-else-if="part === 'current' && ready && currentGroups.length"
    title="Obecny skład"
    :caption="`wpisy bez daty zakończenia, stan na ${longDate(today)}`"
    data-testid="successions-current"
  >
    <!-- ============ obecny skład ============ -->
    <!-- The site's section head, as over every section of an entity page:
         8px over its first group, and the date the board is read at as its
         caption, which on a phone takes a line of its own. -->
    <div
      v-for="group in currentGroups"
      :key="group.key"
      class="k-group"
      :data-testid="`current-role-${group.key}`"
    >
      <!-- The type system's group head, with how many hold the post:
           „Zarząd 3”. -->
      <h3 class="k-group-head board-head">
        {{ group.role }}
        <span class="k-group-head__count">{{ group.people.length }}</span>
      </h3>

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
  </PageSection>

  <PageSection
    v-else-if="part === 'relay' && ready && successions.length"
    title="Kto kogo zastąpił"
    :caption="relayCaption"
    caption-testid="successions-count"
    data-testid="successions-relay"
  >
    <!-- ============ kto kogo zastąpił ============ -->
    <!-- The count beside the head says how many it leaves out, so four
         handovers out of sixty never read as the whole register. How the
         pairs are made, and what is left out, behind the (i): the method
         was four lines of 12px prose between the heading and the first
         card. -->
    <template #info>
      <span
        v-for="item in relayInfo"
        :key="item.testid"
        class="d-block why"
        :data-testid="item.testid"
      >
        <strong>{{ item.title }}.</strong> {{ nbsp(item.text) }}
      </span>
    </template>

    <div
      v-for="section in roleSections"
      :key="section.key"
      class="k-group"
      :data-testid="`succession-role-${section.key}`"
    >
      <!-- With how many handovers the post saw: „Prezes zarządu 4”. No rule
           under it, unlike a board's head: the handovers below are boxes,
           and a line over a box's edge is two lines. -->
      <h3 class="k-group-head">
        {{ section.role }}
        <span class="k-group-head__count">{{ section.count }}</span>
      </h3>
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
            {{
              polishCounting(batch.pairs.length, "zmiana", "zmiany", "zmian")
            }}
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
  </PageSection>
</template>

<script lang="ts" setup>
import {
  mdiAlertCircleOutline,
  mdiArrowDown,
  mdiArrowRight,
  mdiCalendarBlankOutline,
  mdiSwapVertical,
} from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import { createSlug, generateEntityUrl } from "~/composables/slugs";
import { gapLabel, MAX_GAP_DAYS, MAX_OVERLAP_DAYS } from "~~/shared/succession";
import { isoDay, longDate, shortDate } from "~~/shared/dates";
import type {
  CompanySuccessions,
  CurrentPost,
  Succession,
  SuccessionSide,
} from "~~/server/api/edges/successions.get";
import type { AsyncDataRequestStatus } from "#app";

const props = defineProps<{
  companyName: string;
  /** Which part of the company page this instance draws. The page renders
   * the component three times, around its relation history: `current` (who
   * holds a post now, and the spinner or the error while there is no
   * answer), `absent` (one line on what the register does not tell us), and
   * `relay` (who took over from whom). */
  part: "current" | "absent" | "relay";
  /** The answer of `/api/edges/successions` for this company, and the state
   * of the request, from `useCompanySuccessions`: the page asks once and
   * hands the answer to all three parts. */
  data: CompanySuccessions | null | undefined;
  status: AsyncDataRequestStatus;
}>();

/** The roles a reader looks for first, in the order they look: who runs the
 * company, who stands in for them, the rest of the board, then whoever
 * supervises it. Everything else - prokurent, likwidator, a dyrektor biura
 * somebody typed by hand - sorts alphabetically after them. Matched on the
 * lowercased name, the way `shared/succession.ts` matches a seat.
 *
 * The prezes and the deputies used to be in that alphabetical tail, so PKP's
 * current board read Zarząd, dyrektor…, naczelnik…, prezes, zastępca prezesa -
 * „Kolejność osób - prezes, zastępca prezesa, potem zarząd” is the report.
 * They are matched by how the title starts, because the register says
 * „Prezes Zarządu" where somebody adding a relation by hand says „prezes", and
 * both are the same seat - up to a space or the end of the title, so that
 * „prezes" does not also take a „prezesa…" of some other kind.
 *
 * Two entries for the supervisory organ: it reaches this card under whichever
 * name the institution's own form gives it (`displayRole`, applied by
 * `/api/edges/successions`), and a hospital's rada społeczna belongs in the
 * same place a spółka's rada nadzorcza does. No company has both. */
const ROLE_ORDER: RegExp[] = [
  /^prezes( |$)/,
  /^(wiceprezes|zastępca prezesa)( |$)/,
  /^(zarząd|członek zarządu)$/,
  /^rada nadzorcza$/,
  /^rada społeczna$/,
];

/** What a role with no name is called on screen. The pairing drops spells
 * whose role nobody recorded, so this only ever labels a current post. The
 * endpoint leaves out a role-less copy of a prokura that also arrived as
 * „Prokurent" (see `withoutRedundantRoleless`), which used to put one person
 * under both headings; a role-less post beside a zarząd seat is a different
 * post, and keeps this label. */
const NO_ROLE = "Funkcja niepodana w rejestrze";

const failed = computed(() => props.status === "error");
const loading = computed(() => !failed.value && !props.data);

const successions = computed<Succession[]>(() => props.data?.successions ?? []);
const current = computed<CurrentPost[]>(() => props.data?.current ?? []);
const hidden = computed(() => props.data?.hidden ?? 0);
const nothingToShow = computed(
  () => !successions.value.length && !current.value.length && !hidden.value,
);
/** An answer to draw from. Every part but `current` stays silent until then:
 * the spinner and the error are said once, where the people will be. */
const ready = computed(() => !loading.value && !failed.value);

/** Today, fixed at render and carried into the browser in the payload, so the
 * server and the client cannot disagree about what "stan na" says. Local
 * components rather than `toISOString`, which would answer yesterday for the
 * first two hours of a Warsaw day. */
const today = useState("succession-today", () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});

/* ---------- durations ---------- */

/** How long a spell ran, in years and months. An open spell is measured to
 * today, which is what "2 lata na stanowisku" means on a current post. */
function duration(start: string | null, end: string | null): string {
  const from = isoDay(start);
  const to = isoDay(end) ?? isoDay(today.value);
  if (!from || !to) return "";
  let months = (to.y - from.y) * 12 + (to.m - from.m);
  if (to.d < from.d) months -= 1;
  if (months < 1) return "poniżej miesiąca";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} mies.`;
  return `${polishCounting(years, "rok", "lata", "lat")}${rest ? ` ${rest} mies.` : ""}`;
}

/** The whole spell behind one side of a handover, so a row stands on its own
 * rather than only naming the day the seat changed hands. */
function spell(side: SuccessionSide): string {
  if (!side.start) return "brak daty rozpoczęcia";
  const end = side.end ? shortDate(side.end) : "obecnie";
  const length = duration(side.start, side.end);
  return `${shortDate(side.start)} - ${end}${length ? ` · ${length}` : ""}`;
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
  const at = ROLE_ORDER.findIndex((pattern) => pattern.test(key));
  return at < 0 ? ROLE_ORDER.length : at;
}

/** Prezes, the deputies, Zarząd, Rada Nadzorcza, then whatever else the
 * register holds, in Polish collation. */
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

/** „4 zmiany w 2 funkcjach · 5 pominiętych”: the relay's cards, the roles
 * they fall under, and the handovers left out. */
const relayCaption = computed(() => {
  const shown =
    `${polishCounting(successions.value.length, "zmiana", "zmiany", "zmian")} ` +
    `w ${polishCounting(roleSections.value.length, "funkcji", "funkcjach", "funkcjach")}`;
  return hidden.value
    ? `${shown} · ${polishCounting(hidden.value, "pominięta", "pominięte", "pominiętych")}`
    : shown;
});

/* ---------- what the page does not have ---------- */

/** One paragraph of a bubble: what it is about, the sentence, and the hook a
 * test finds it by - the testid the sentence carried when it stood in the
 * page's flow. */
type Why = { title: string; text: string; testid: string };

/** Each sentence that used to stand in an empty section, word for word. */
const sentences = computed(() => ({
  empty:
    `Nie mamy wpisów kadencyjnych dla: ${props.companyName}. Kiedy rejestr ` +
    "poda daty powołania i odwołania, pojawi się tu obecny skład i to, kto " +
    "kogo zastąpił.",
  // Two reasons, and the page cannot tell them apart: the endpoint drops a
  // post whose holder has no page without counting it, the way the rest of
  // the site does.
  currentEmpty:
    "Nie mamy tu nikogo z otwartym wpisem: albo każdy wpis, który znamy, ma " +
    "już datę zakończenia, albo brakuje strony osoby, która zajmuje " +
    "stanowisko.",
  none:
    "Nie dopasowaliśmy tu żadnej zmiany: wpisy, które znamy, nie mają dat, " +
    `albo nikt nie objął stanowiska w oknie ${MAX_GAP_DAYS} dni od jego ` +
    "zwolnienia.",
  // Why the handovers are fewer than the register's. Said, because two of
  // fifteen with no word on the rest reads as a bug.
  hidden:
    `Nie pokazujemy ${polishCounting(hidden.value, "zmiany", "zmian", "zmian")}\u00a0- ` +
    "brakuje strony jednej z osób. W zestawieniu są tylko te zmiany, w " +
    "których obie osoby mają u nas swoją stronę.",
  method:
    "Pary dobrane 1:1 w obrębie tej spółki i tej samej funkcji: koniec " +
    "jednego wpisu i początek kolejnego w oknie od " +
    `${MAX_OVERLAP_DAYS} dni przed do ${MAX_GAP_DAYS} dni po. Wpisy z tego ` +
    "samego dnia zebrano w jedno zdarzenie.",
}));

/** What stands behind the relay's (i) when the relay is drawn. */
const relayInfo = computed<Why[]>(() => [
  ...(hidden.value
    ? [
        {
          title: "Pominięte zmiany",
          text: sentences.value.hidden,
          testid: "successions-hidden",
        },
      ]
    : []),
  {
    title: "Jak dobieramy pary",
    text: sentences.value.method,
    testid: "relay-method",
  },
]);

/** The one line under the people: which of the two sections is missing, and
 * how many handovers were left out when that is why the relay is. Nothing
 * when both are on the page. */
const absentLine = computed(() => {
  const noCurrent = !currentGroups.value.length;
  const noRelay = !successions.value.length;
  const skipped = hidden.value;
  if (noCurrent && noRelay && !skipped) {
    return "Nie znamy obecnego składu ani zmian na stanowiskach.";
  }
  const parts: string[] = [];
  if (noCurrent) parts.push("Nie znamy obecnego składu.");
  if (noRelay && !skipped) parts.push("Nie znamy zmian na stanowiskach.");
  if (noRelay && skipped) {
    const where = skipped === 1 ? "stanowisku" : "stanowiskach";
    parts.push(
      `Pominęliśmy ${polishCounting(skipped, "zmianę", "zmiany", "zmian")} na ${where}, ` +
        "bo brakuje strony jednej z osób.",
    );
  }
  // No one-letter word at the end of a line: „…jednej z / osób.” is the
  // phone's break otherwise.
  return nbsp(parts.join(" "));
});

/** The line up to its last word, and the last word, which the template keeps
 * on one line with the (i) after it. */
const absentHead = computed(() =>
  absentLine.value.slice(0, absentLine.value.lastIndexOf(" ") + 1),
);
const absentTail = computed(() =>
  absentLine.value.slice(absentLine.value.lastIndexOf(" ") + 1),
);

/** Behind the line's (i): the sentence each missing section used to print,
 * and - when the relay is the one missing - what it leaves out and how its
 * pairs are made, which would otherwise sit behind the relay's own (i). */
const absentInfo = computed<Why[]>(() => {
  if (nothingToShow.value) {
    return [
      {
        title: "Obecny skład i zmiany",
        text: sentences.value.empty,
        testid: "successions-empty",
      },
    ];
  }
  const items: Why[] = [];
  if (!currentGroups.value.length) {
    items.push({
      title: "Obecny skład",
      text: sentences.value.currentEmpty,
      testid: "current-empty",
    });
  }
  if (!successions.value.length) {
    items.push({
      title: "Kto kogo zastąpił",
      text: sentences.value.none,
      testid: "successions-none",
    });
    items.push(...relayInfo.value);
  }
  return items;
});
</script>

<style scoped>
/* `k-card`, `k-card--accent` and `k-note` are global (`app.vue`), and the
   section heads are the site's `PageSection`. They used to be here too, at
   values a little off the ones `succession/PersonChanges.vue` carried - 8px
   round instead of 10, a 4px full-height rail instead of a 3px inset one, a
   baseline-aligned heading instead of a centred one, and a head 16px over
   its content where every other section's stands 8. Nobody chose that; they
   were copied at different times. The company page moves to the shared
   values, which is what lets the notes underneath these cards be the same
   object as the cards themselves. The group heads (`k-group-head`,
   assets/css/type.css) and the line on what the page lacks (`k-absent`) are
   the shared ones too, the same as on a person's page. */

/* A bubble that says more than one thing: a gap between its paragraphs. */
.why + .why {
  margin-top: 6px;
}

/* Over a board's cards, and only there, a hairline under the group head:
   the cards stand apart in a grid, and without the line three of them read
   as three loose boxes rather than one board. A list that is one box of its
   own - the history, the handovers below - needs no line over its edge. */
.board-head {
  border-bottom: 1px solid var(--k-line);
  padding-bottom: 6px;
}

/* ---- obecny skład ---- */

/* Sage behind ink rather than as ink: the one thing a reader scanning the
   section is looking for is who is in the seat now. */
.now-pill {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.22);
  border-radius: var(--k-r-control);
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: inline-flex;
  font-size: var(--k-meta-size);
  font-weight: 600;
  gap: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}

/* ---- the relay ---- */

.ev-head {
  align-items: center;
  border-bottom: 1px solid var(--k-line);
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
  font-size: var(--k-ui-size);
  font-weight: 700;
}

.ev-badge {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: var(--k-r-pill);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-meta-size);
  font-weight: 700;
  padding: 1px 9px;
  white-space: nowrap;
}

.ev-sub {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: var(--k-meta-size);
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
  border-top: 1px solid var(--k-line);
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

/* A person's name in a list: 16/700, the one weight below the page title. */
.rl-name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.rl-meta {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Which side of the handover a block is, on the phone layout only: on a wide
   row the legend above the cards says it once for the whole role. */
.rl-ovl {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  display: none;
  font-size: var(--k-meta-size);
  font-weight: 600;
  margin-bottom: 2px;
}

.av {
  border-radius: 50%;
  display: grid;
  flex: 0 0 auto;
  font-size: var(--k-meta-size);
  font-weight: 700;
  height: 34px;
  place-items: center;
  width: 34px;
}

/* Faded = the post was left; sage = the post is now theirs. */
.av--out {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
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
  font-size: var(--k-meta-size);
  line-height: 1.3;
  padding: 0 4px;
  position: relative;
  text-align: center;
}

.rl-flip {
  background: rgb(var(--v-theme-secondary));
  border-radius: var(--k-r-pill);
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: var(--k-meta-size);
  font-weight: 700;
  padding: 1px 8px;
  position: relative;
  white-space: nowrap;
}

.rl-disc .arrow-v {
  display: none;
}

/* Column labels once per role, not once per card. */
.rl-legend {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  display: grid;
  font-size: var(--k-meta-size);
  font-weight: 600;
  gap: 10px;
  grid-template-columns: 1fr 184px 1fr;
  padding: 0 17px 8px 21px;
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

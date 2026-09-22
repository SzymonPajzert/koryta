<template>
  <div class="pa-4">
    <div class="mb-6">
      <h1 class="text-h4 mb-1">Aktywność</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Co ostatnio zrobili inni: oceny, notatki, propozycje zmian i decyzje
        administratorów. Nowe wpisy pojawiają się po kilku minutach.
      </p>
    </div>

    <!-- Scrolls sideways rather than wrapping: five outlined buttons do not
         fit 375px, and a toggle broken over two lines stops reading as one
         choice. -->
    <div class="activity__kinds mb-3">
      <v-btn-toggle
        v-model="kindGroup"
        density="compact"
        variant="outlined"
        divided
        mandatory
      >
        <v-btn :value="ALL_KINDS" size="small">Wszystko</v-btn>
        <v-btn
          v-for="group in kindGroupOptions"
          :key="group"
          :value="group"
          size="small"
        >
          {{ feedKindGroupLabels[group] }}
        </v-btn>
      </v-btn-toggle>
    </div>

    <div
      v-if="feed?.identified || personLabel"
      class="d-flex flex-wrap align-center ga-2 mb-4"
    >
      <!-- Off the response, not off `isAdmin`: the claim says "admin", and a
           trial administrator holds it too. Only the server knows who counts
           as established, and it says so with `identified`. -->
      <v-chip
        v-if="feed?.identified"
        :variant="showingNewAdmins ? 'flat' : 'outlined'"
        :class="{ 'bg-surface-warning': showingNewAdmins }"
        :prepend-icon="mdiAccountClockOutline"
        :aria-pressed="showingNewAdmins"
        data-testid="activity-new-admins"
        @click="toggleNewAdmins"
      >
        Nowi administratorzy
      </v-chip>
      <!-- The label truncates rather than the chip: an administrator's label
           can be a whole email address, and at 375px that pushed the close
           button past the edge of the screen. -->
      <v-chip
        v-if="personLabel"
        closable
        class="activity__person"
        :prepend-icon="mdiFilterVariant"
        data-testid="activity-person-filter"
        @click:close="clearPerson"
      >
        <span class="text-truncate" :title="personLabel">{{
          personLabel
        }}</span>
      </v-chip>
    </div>

    <!-- Everybody on trial, including whoever did nothing - which is exactly
         what the feed below cannot show. -->
    <v-card
      v-if="feed && showingNewAdmins"
      variant="outlined"
      class="mb-4"
      data-testid="activity-new-admin-list"
    >
      <v-card-text class="py-2">
        <div v-if="feed.newAdmins.length === 0" class="text-body-2">
          Nikt nie ma teraz statusu nowego administratora.
        </div>
        <div
          v-for="row in newAdminRows"
          :key="row.actor.key"
          class="d-flex flex-wrap align-center ga-2 py-1"
        >
          <button
            type="button"
            class="activity__actor"
            :aria-label="`Pokaż tylko: ${row.actor.name}`"
            @click="focusActor(row.actor)"
          >
            <!-- The same rule as a feed line's: a uid means the reader is an
                 administrator shown the name whatever its owner chose, so the
                 tooltip must not say they agreed to it. -->
            <StatsContributorName
              :row="row.actor"
              :identified="row.actor.uid !== null"
            />
          </button>
          <span class="text-body-2 text-medium-emphasis">
            {{
              row.batches === 0
                ? "brak aktywności w tym okresie"
                : polishCounting(row.batches, "wpis", "wpisy", "wpisów")
            }}
          </span>
        </div>
      </v-card-text>
    </v-card>

    <!-- Only with nothing to show: a month that fails after the week arrived
         keeps the week, see `widenFailed`. -->
    <v-alert
      v-if="error && !feed"
      type="error"
      variant="tonal"
      class="mb-4"
      text="Nie udało się pobrać aktywności."
    />

    <template v-else>
      <v-alert
        v-if="widenFailed && !loadingOlder"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
        data-testid="activity-widen-failed"
        text="Nie udało się pobrać starszych wpisów."
      />

      <v-alert
        v-if="feed?.truncated.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
        text="W tym okresie było więcej, niż zdążyliśmy przejrzeć - lista jest niepełna."
      />

      <v-skeleton-loader v-if="waiting" type="list-item-two-line@4" />

      <v-alert
        v-else-if="filtered.length === 0"
        type="info"
        variant="tonal"
        :text="
          feed?.batches.length
            ? 'Nic nie pasuje do wybranych filtrów.'
            : 'W tym okresie nikt nic nie zrobił.'
        "
      />

      <section
        v-for="group in dayGroups"
        :key="group.day"
        class="mb-4"
        data-testid="activity-day"
      >
        <h2 class="text-subtitle-2 text-medium-emphasis mb-1">
          {{ group.label }}
        </h2>
        <v-card variant="outlined">
          <template v-for="(batch, index) in group.batches" :key="batch.id">
            <v-divider v-if="index > 0" />
            <ActivityFeedItem
              :batch="batch"
              :actor="actorOf(batch)"
              @select-actor="focusActor"
            />
          </template>
        </v-card>
      </section>

      <!-- One button, like the home feed's: it pages through what is loaded,
           and once that runs out on a week it asks for the month. A second
           control for "older" would be a choice the reader cannot make
           without knowing how the list is fetched. -->
      <div v-if="moreLabel" class="d-flex justify-center mt-4">
        <v-btn
          variant="outlined"
          :loading="loadingOlder"
          data-testid="activity-more"
          @click="showMore"
        >
          {{ moreLabel }}
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiAccountClockOutline, mdiFilterVariant } from "@mdi/js";
import {
  defaultFeedRange,
  feedKindGroupLabels,
  feedKindGroups,
  type ActivityFeed,
  type FeedActor,
  type FeedBatch,
  type FeedKind,
  type FeedKindGroup,
  type FeedRange,
} from "~~/shared/activityFeed";
import { isoDay, warsawDate } from "~~/shared/dates";
import { authRequest } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import { useQueryFilters } from "~/composables/queryFilters";

definePageMeta({
  middleware: "auth",
  // Nothing here is for a reader who is not signed in, and it names people
  // next to what they did and when.
  robots: false,
  // One line per sitting reads as a sentence at this width; at the default
  // 1200 px the name, the verb and the time drift apart.
  maxWidth: 800,
});

useHead({ title: "Aktywność - koryta.pl" });

/** The toggle's value for "no kind filter", kept out of the url. */
const ALL_KINDS = "wszystko";

/** `?kto=` for the reader's own lines. */
const SELF = "ja";

/** `?kto=` for everybody on trial. Honoured only for an established
 * administrator, the one reader the server tells who that is. */
const NEW_ADMINS = "nowi-admini";

/** Lines the list shows at a time, and how many more each click reveals. */
const PAGE_SIZE = 30;

/** A week with fewer lines than this is widened to a month on its own: a
 * handful of lines reads as "nobody works here", and the month is there to be
 * had for one more request. */
const WIDEN_BELOW = 10;

/** The window "Pokaż starsze" and the automatic widening switch to. */
const WIDE_RANGE: FeedRange = 30;

const kindGroupOptions = Object.keys(feedKindGroups) as FeedKindGroup[];

const days = ref<FeedRange>(defaultFeedRange);

/** The month was asked for and could not be had, so what is on screen is still
 * the week. A warning above it rather than the error that blanks the page: the
 * month is its own, heavier scan on the server, and the week having answered
 * says nothing about whether the month will. */
const widenFailed = ref(false);

/** Fetched in the browser, with the reader's token: what a line shows depends
 * on who is asking, and the server-rendered page is the same for everybody.
 *
 * One key for both windows, so the week stays on screen while the month loads
 * instead of the list collapsing to a skeleton and back. Never awaited - the
 * header and the filters do not wait for it.
 *
 * A failure with a response already on screen answers with that response
 * again. Thrown, Nuxt would reset `feed` to nothing and the week that loaded
 * fine would give way to an error; and handing back the same object does not
 * wake the watch below, so a failed widening is not retried in a loop. */
const {
  data: feed,
  status,
  error,
  refresh,
} = useAsyncData<ActivityFeed>(
  "activity-feed",
  async (): Promise<ActivityFeed> => {
    try {
      const answer = await authRequest<ActivityFeed>("/api/activity/feed", {
        method: "GET",
        query: { days: days.value },
      });
      widenFailed.value = false;
      return answer;
    } catch (cause) {
      if (!feed.value) throw cause;
      widenFailed.value = true;
      return feed.value;
    }
  },
  { server: false, lazy: true, watch: [days] },
);

const { stringFilter, setQuery } = useQueryFilters();
const rodzaj = stringFilter("rodzaj");
const kto = stringFilter("kto");

/** A named person picked by a reader who is given no uids. Page state only:
 * their key is numbered per response, so in a url - or across the next
 * response - it would quietly point at somebody else. */
const pickedActorKey = ref<string | null>(null);

function isKindGroup(value: string | null): value is FeedKindGroup {
  return kindGroupOptions.some((group) => group === value);
}

const kindGroup = computed<FeedKindGroup | typeof ALL_KINDS>({
  get: () => (isKindGroup(rodzaj.value) ? rodzaj.value : ALL_KINDS),
  set: (value) => {
    rodzaj.value = value === ALL_KINDS ? null : value;
  },
});

type PersonFilter =
  | { kind: "self" }
  | { kind: "newAdmins" }
  | { kind: "uid"; uid: string }
  | { kind: "actor"; key: string };

const personFilter = computed<PersonFilter | null>(() => {
  if (pickedActorKey.value) return { kind: "actor", key: pickedActorKey.value };
  if (kto.value === SELF) return { kind: "self" };
  // Anything else names somebody by a uid, or by a status only an established
  // administrator is told, so for anybody else it filters nothing.
  if (!kto.value || !feed.value?.identified) return null;
  if (kto.value === NEW_ADMINS) return { kind: "newAdmins" };
  return { kind: "uid", uid: kto.value };
});

const showingNewAdmins = computed(
  () => personFilter.value?.kind === "newAdmins",
);

const actorsByKey = computed(
  () => new Map((feed.value?.actors ?? []).map((actor) => [actor.key, actor])),
);

/** Every batch names an actor listed in the same response; this is a mask
 * rather than a crash if one ever does not. */
function actorOf(batch: FeedBatch): FeedActor {
  return (
    actorsByKey.value.get(batch.actorKey) ?? {
      key: batch.actorKey,
      uid: null,
      name: "Nieznana osoba",
      named: false,
      isSelf: false,
      photoURL: null,
      newAdmin: false,
    }
  );
}

function matchesPerson(batch: FeedBatch, filter: PersonFilter): boolean {
  const actor = actorOf(batch);
  switch (filter.kind) {
    case "self":
      return actor.isSelf;
    case "newAdmins":
      return actor.newAdmin;
    case "uid":
      return actor.uid === filter.uid;
    case "actor":
      return batch.actorKey === filter.key;
  }
}

const filtered = computed(() => {
  const batches = feed.value?.batches ?? [];
  const group = kindGroup.value;
  const kinds: readonly FeedKind[] | null =
    group === ALL_KINDS ? null : feedKindGroups[group];
  const person = personFilter.value;
  return batches.filter(
    (batch) =>
      (!kinds || kinds.includes(batch.kind)) &&
      (!person || matchesPerson(batch, person)),
  );
});

/** What the closable chip says. The new-admin filter has a chip of its own. */
const personLabel = computed(() => {
  const filter = personFilter.value;
  if (!filter || filter.kind === "newAdmins") return null;
  if (filter.kind === "self") return "Tylko Twoje";
  const everybody = [
    ...(feed.value?.actors ?? []),
    ...(feed.value?.newAdmins ?? []),
  ];
  const actor =
    filter.kind === "uid"
      ? everybody.find((candidate) => candidate.uid === filter.uid)
      : everybody.find((candidate) => candidate.key === filter.key);
  return actor ? `Tylko: ${actor.name}` : "Tylko wybrana osoba";
});

function focusActor(actor: FeedActor) {
  if (actor.isSelf) {
    pickedActorKey.value = null;
    kto.value = SELF;
  } else if (feed.value?.identified && actor.uid) {
    pickedActorKey.value = null;
    kto.value = actor.uid;
  } else if (actor.named) {
    kto.value = null;
    pickedActorKey.value = actor.key;
  }
}

function clearPerson() {
  pickedActorKey.value = null;
  kto.value = null;
}

function toggleNewAdmins() {
  pickedActorKey.value = null;
  kto.value = showingNewAdmins.value ? null : NEW_ADMINS;
}

/** Everybody on trial with how many lines they have in the window, whatever
 * kind is picked above - "brak aktywności" has to mean nothing at all. */
const newAdminRows = computed(() => {
  const counts = new Map<string, number>();
  for (const batch of feed.value?.batches ?? []) {
    counts.set(batch.actorKey, (counts.get(batch.actorKey) ?? 0) + 1);
  }
  return (feed.value?.newAdmins ?? []).map((actor) => ({
    actor,
    batches: counts.get(actor.key) ?? 0,
  }));
});

const shown = ref(PAGE_SIZE);

watch([kindGroup, kto, pickedActorKey], () => {
  shown.value = PAGE_SIZE;
});

// A person picked in the page always leaves `kto` empty, so a `kto` that turns
// up afterwards came from the url - Back, Forward, a link - and is the filter
// the reader navigated to. The pick used to outrank it, and the chip and the
// list then disagreed with the address bar.
watch(kto, (value) => {
  if (value) pickedActorKey.value = null;
});

/** A `?kto=` naming a uid or the trial filter, for a reader the server tells
 * no uids to. It filters nothing (see `personFilter`), so it is taken out of
 * the url rather than left there claiming a filter the list is not applying -
 * which is where the link on /admin, or one passed on, leaves an administrator
 * on trial. */
const unhonouredKto = computed(
  () =>
    feed.value?.identified === false &&
    kto.value !== null &&
    kto.value !== SELF,
);

watch(
  unhonouredKto,
  (unhonoured) => {
    if (unhonoured) void setQuery({ kto: null }, { replace: true });
  },
  { immediate: true },
);

watch(feed, (value) => {
  pickedActorKey.value = null;
  // Once: the month is the widest window there is, so this cannot fire twice.
  if (
    value &&
    days.value === defaultFeedRange &&
    value.batches.length < WIDEN_BELOW
  ) {
    days.value = WIDE_RANGE;
  }
});

const visible = computed(() => filtered.value.slice(0, shown.value));

const hasMoreLoaded = computed(() => filtered.value.length > shown.value);

/** Set by the click that asked for the month, until it answers. Not `status`:
 * the page also widens by itself, and "Pokaż więcej" only pages through what
 * is loaded, so neither may spin for a request this click did not start. */
const loadingOlder = ref(false);

watch(status, (value) => {
  if (value !== "pending") loadingOlder.value = false;
});

const moreLabel = computed(() => {
  if (!feed.value) return null;
  // Kept, spinning, while the month loads. It used to vanish on the click,
  // and with the week still on screen nothing said the click had done
  // anything.
  if (loadingOlder.value) return "Pokaż starsze";
  if (hasMoreLoaded.value) return "Pokaż więcej";
  // Off the window on screen, not off `days`: after a month that failed,
  // `days` already says 30 while the list is still the week, and this is how
  // to ask again. Not while the page is fetching the month by itself.
  return feed.value.window.days === defaultFeedRange &&
    status.value !== "pending"
    ? "Pokaż starsze"
    : null;
});

function showMore() {
  if (!hasMoreLoaded.value) {
    // The month starts with the same lines the week ended on, so the next
    // page is whatever comes after what is on screen now.
    loadingOlder.value = true;
    shown.value = filtered.value.length;
    // A retry after a failed month: `days` is 30 already, so the watch on it
    // will not ask again by itself.
    if (days.value === WIDE_RANGE) void refresh();
    else days.value = WIDE_RANGE;
  }
  shown.value += PAGE_SIZE;
}

/** Nothing to draw yet, or nothing drawn while the month replaces an empty
 * week - which would otherwise flash "nikt nic nie zrobił" first. */
const waiting = computed(
  () =>
    !feed.value || (status.value === "pending" && filtered.value.length === 0),
);

const WEEKDAY = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Warsaw",
});

/** The Warsaw day before `day`, counted on the calendar. Subtracting 24 hours
 * from now instead lands two days back in the first hour after the spring
 * clock change. */
function previousDay(day: string): string {
  const parts = isoDay(day);
  if (!parts) return "";
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d - 1))
    .toISOString()
    .slice(0, 10);
}

function dayLabel(day: string, at: Date, today: string): string {
  if (day === today) return "Dzisiaj";
  if (day === previousDay(today)) return "Wczoraj";
  const label = WEEKDAY.format(at);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The visible lines under their Warsaw day, by when each sitting ended. The
 * list is newest first, so a day's lines are always consecutive. */
const dayGroups = computed(() => {
  const today = warsawDate();
  const groups: { day: string; label: string; batches: FeedBatch[] }[] = [];
  for (const batch of visible.value) {
    const at = new Date(batch.lastAt);
    const day = warsawDate(at);
    const last = groups.at(-1);
    if (last?.day === day) {
      last.batches.push(batch);
    } else {
      groups.push({ day, label: dayLabel(day, at, today), batches: [batch] });
    }
  }
  return groups;
});
</script>

<style scoped>
.activity__kinds {
  overflow-x: auto;
  scrollbar-width: none;
}

.activity__kinds::-webkit-scrollbar {
  display: none;
}

/* Vuetify lets the chip shrink but not its content, so the label cannot
   truncate and the close button, drawn last, is what gets cut off. */
.activity__person :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
}

.activity__actor {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
</style>

<template>
  <div class="w-100">
    <h1 class="text-h5 text-sm-h4 mb-2">Użytkownicy</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Konta na koryta.pl: kto ma jakie uprawnienia, kto prosi o dostęp i kto
      jest na okresie próbnym. Tu nominujesz zmianę roli - nadaje ją dopiero
      skrypt, gdy właściciel go uruchomi i zmianę zatwierdzi.
    </p>

    <div class="users-controls mb-2">
      <v-text-field
        v-model="search"
        class="users-controls__search"
        label="Szukaj: nazwa, e-mail albo uid"
        :prepend-inner-icon="mdiMagnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        data-user-search
      />
      <v-switch
        v-model="showAll"
        label="Pokaż wszystkie konta"
        color="primary"
        density="compact"
        hide-details
        inset
        data-scope-switch
      />
    </div>

    <FeedbackFilterChips
      v-if="users.length > 0"
      v-model="level"
      :options="levelOptions"
      class="mb-2"
    />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
    </v-alert>
    <v-alert
      v-if="data?.truncated"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Kont jest więcej, niż przegląd w Firebase zdążył przejść - lista jest
      niepełna.
    </v-alert>
    <v-alert
      v-if="missingTarget"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      data-missing-target
    >
      Nie ma takiego konta na liście.
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate class="mb-4" />

    <template v-for="section in sections" :key="section.key">
      <section v-if="section.count > 0" :data-section="section.key">
        <AdminSectionHead
          :title="section.title"
          :count="section.count"
          :info="section.info"
        />
        <AdminRowList class="mb-4">
          <AdminUsersRow
            v-for="row in section.rows"
            :key="row.uid"
            :row="row"
            :section="section.key"
            :now="now"
            :self="row.uid === ownUid"
            :detail="details[row.uid]"
            :busy="busy.has(row.uid)"
            :highlighted="targetUid === row.uid"
            :act="act"
            :expanded="openRows.has(row.uid)"
            @update:expanded="(open: boolean) => setOpen(row.uid, open)"
            @retry="loadDetail(row.uid, { force: true })"
          />
        </AdminRowList>
        <!-- With "Pokaż wszystkie konta" the rest runs into the thousands:
             the first hundred, by who was here last, and the others on
             request. The search finds anybody in the whole list. -->
        <v-btn
          v-if="section.hidden > 0"
          variant="text"
          size="small"
          class="mb-4"
          :prepend-icon="mdiChevronDown"
          data-show-more
          @click="showAllOthers = true"
        >
          Pokaż pozostałych ({{ section.hidden }})
        </v-btn>
      </section>
    </template>

    <p
      v-if="data && !loading && users.length > 0 && shownCount === 0"
      class="text-body-2 text-medium-emphasis my-4"
      data-nothing-matches
    >
      Nikt nie pasuje do wyszukiwania.
    </p>

    <v-snackbar
      v-model="snackbar"
      :timeout="snackbarColor === 'error' ? 6000 : 4000"
      :color="snackbarColor"
    >
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
/** /admin/uzytkownicy: every account, the requests for access, the
 * nominations waiting for the claims script, the trials somebody has to end,
 * and the form that nominates.
 *
 * Only established administrators open it - the `established-admin`
 * middleware here, `requireEstablishedAdmin` on every route behind it -
 * because it shows every address and lets the reader ask for anybody's role to
 * change. The administrators on trial are the people the page watches.
 *
 * Nothing here changes a role. A nomination is a wish written to
 * `roleNominations`; the owner's run of `set_auth_claims` shows him each one
 * and applies it on his y. So the page's job is to make the wish precise and
 * argued, and to show what is still waiting for the script - "pending" is
 * always the wish against the account's live claims, read by the server. */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { mdiChevronDown, mdiMagnify } from "@mdi/js";
import {
  levelFromSlug,
  levelSlugs,
  matchesUserSearch,
  useAdminUsers,
  userSections,
  type UserSectionKey,
} from "~/composables/adminUsers";
import { useAuthState } from "~/composables/auth";
import { useQueryFilters } from "~/composables/queryFilters";
import { roleLevelLabels, roleLevels } from "~~/shared/roles";
import {
  TRIAL_REVIEW_DAYS,
  USER_ACTIVITY_WINDOW_DAYS,
  type UserListScope,
} from "~~/shared/userAdmin";

definePageMeta({
  // `admin` as well, though every established administrator is one: it is
  // what lights the Admin menu while the page is open.
  middleware: ["admin", "established-admin"],
  // One column of rows, like the other admin lists.
  maxWidth: 1100,
});

useHead({ title: "Użytkownicy (Admin) - koryta.pl" });

const route = useRoute();
const router = useRouter();
const { user } = useAuthState();
const ownUid = computed(() => user.value?.uid ?? null);

const {
  data,
  loading,
  error,
  details,
  busy,
  load,
  loadDetail,
  act,
  snackbar,
  snackbarText,
  snackbarColor,
} = useAdminUsers();

const users = computed(() => data.value?.users ?? []);

/** The clock trials are counted against: when the list was read, so a page
 * left open overnight does not flag a trial its numbers do not show yet. */
const now = ref(new Date());
watch(data, () => (now.value = new Date()));

/** The account a `#u-<uid>` hash names - what the access-request buttons and
 * the history links point at. The router has already decoded it. */
const hashTarget = () => /^#u-(.+)$/.exec(route.hash)?.[1] ?? null;
const targetUid = computed(hashTarget);
const missingTarget = ref(false);

// ---- filters, kept in the url ----

const { choiceFilter, setQuery } = useQueryFilters();

/** `?zakres=wszyscy` asks the server for every account rather than the ones
 * with a role, a request, sign-ins or recent activity; the default stays out
 * of the url. */
const scopeParam = choiceFilter<UserListScope>("zakres", "aktywni");
const scope = computed<UserListScope>(() =>
  scopeParam.value === "wszyscy" ? "wszyscy" : "aktywni",
);
const showAll = computed({
  get: () => scope.value === "wszyscy",
  set: (value: boolean) => (scopeParam.value = value ? "wszyscy" : "aktywni"),
});

const ALL = "wszystkie";
const levelParam = choiceFilter<string>("poziom", ALL);
/** Anything the url says that is not a level is every level. */
const level = computed<string>({
  get: () => (levelFromSlug(levelParam.value) ? levelParam.value : ALL),
  set: (value) => (levelParam.value = value),
});

/** What is typed - null once the field's clear button has been used. The
 * field is what the list filters by, and the url only keeps a copy, written
 * once typing stops and as a replace, so the back button does not walk back
 * through every letter. Never read back while typing: a navigation for "a"
 * landing after "ab" was typed would put "a" back in the field. */
const search = ref<string | null>(String(route.query.szukaj ?? ""));
let searchWrite: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
  clearTimeout(searchWrite);
  searchWrite = setTimeout(
    () =>
      void setQuery({ szukaj: value?.trim() || undefined }, { replace: true }),
    300,
  );
});
// A write still waiting when the page goes would land on whatever replaced it.
onBeforeUnmount(() => clearTimeout(searchWrite));

const searched = computed(() =>
  users.value.filter((row) => matchesUserSearch(row, search.value ?? "")),
);

const levelOptions = computed(() => [
  { value: ALL, title: "Wszystkie", count: searched.value.length },
  ...roleLevels.map((option) => ({
    value: levelSlugs[option],
    title: roleLevelLabels[option].title,
    count: searched.value.filter((row) => row.current.level === option).length,
  })),
]);

const filtered = computed(() => {
  const chosen = levelFromSlug(level.value);
  return chosen
    ? searched.value.filter((row) => row.current.level === chosen)
    : searched.value;
});

// ---- sections ----

/** How many of the rest are drawn before "Pokaż pozostałych". */
const OTHERS_SHOWN = 100;
const showAllOthers = ref(false);

const sectionText: Record<UserSectionKey, { title: string; info: string }> = {
  requests: {
    title: "Prośby o dostęp",
    info:
      "Osoby, które poprosiły o narzędzia zespołu - z /pomoc albo z " +
      "rozszerzenia. Nominacja na „Zespół” albo wyżej zamyka prośbę; " +
      "„Odrzuć prośbę” zamyka ją bez zmiany roli.",
  },
  pending: {
    title: "Czeka na skrypt",
    info:
      "Nominacje, których skrypt jeszcze nie zastosował: rola, o którą " +
      "poproszono, różni się od tej, którą konto ma teraz. Zacznie działać, " +
      "gdy właściciel uruchomi set_auth_claims i ją zatwierdzi.",
  },
  trials: {
    title: "Okresy próbne",
    info:
      "Administratorzy na okresie próbnym, od najdłuższego. Po " +
      `${TRIAL_REVIEW_DAYS} dniach okres jest oznaczony na czerwono - czas ` +
      "go zakończyć albo odebrać uprawnienia.",
  },
  team: {
    title: "Zespół i administratorzy",
    info:
      "Konta z uprawnieniami ponad zwykłego uczestnika: administratorzy, " +
      "zespół i zaufani uczestnicy.",
  },
  others: {
    title: "Pozostali",
    info: "",
  },
};

const othersInfo = computed(() =>
  scope.value === "wszyscy"
    ? "Wszystkie pozostałe konta, od tych, które były na stronie ostatnio. Szare to konta techniczne."
    : "Uczestnicy, którzy coś zrobili w ostatnich " +
      `${USER_ACTIVITY_WINDOW_DAYS} dniach, logowali się od wprowadzenia ` +
      "statystyk albo założyli konto w ostatnich 30 dniach. Resztę pokazuje " +
      "„Pokaż wszystkie konta”.",
);

const sections = computed(() => {
  const grouped = userSections(filtered.value);
  return (Object.keys(sectionText) as UserSectionKey[]).map((key) => {
    let rows = grouped[key];
    let hidden = 0;
    if (key === "others" && !showAllOthers.value) {
      // The row a link points at is drawn wherever it falls.
      const shown = rows.filter(
        (row, index) => index < OTHERS_SHOWN || row.uid === targetUid.value,
      );
      hidden = rows.length - shown.length;
      rows = shown;
    }
    return {
      key,
      title: sectionText[key].title,
      info: key === "others" ? othersInfo.value : sectionText[key].info,
      rows,
      count: grouped[key].length,
      hidden,
    };
  });
});

const shownCount = computed(() =>
  sections.value.reduce((sum, section) => sum + section.count, 0),
);

// ---- open rows and links ----

/** Rows that are open. Kept here rather than in each row so a link can open
 * the one it points at, and so a row stays open while a search re-sorts the
 * sections around it. Opening one fetches its detail, once. */
const openRows = reactive(new Set<string>());

function setOpen(uid: string, open: boolean) {
  if (!open) {
    openRows.delete(uid);
    return;
  }
  openRows.add(uid);
  void loadDetail(uid);
}

/** Bring the account a link points at into view, open: the rows arrive after
 * the router has already tried to scroll, a filter may hide it, and an
 * account with nothing to its name is only in the full list. */
async function focusTarget() {
  const uid = hashTarget();
  missingTarget.value = false;
  if (!uid) return;
  let row = users.value.find((entry) => entry.uid === uid);
  if (!row && scope.value === "aktywni" && !error.value) {
    // Replaced rather than pushed, with the hash kept: the link is where the
    // reader went, the narrower list was only in its way.
    await router.replace({
      query: { ...route.query, zakres: "wszyscy" },
      hash: route.hash,
    });
    await load("wszyscy");
    row = users.value.find((entry) => entry.uid === uid);
  }
  if (!row) {
    missingTarget.value = !loading.value && !error.value;
    return;
  }
  if (!filtered.value.includes(row)) {
    const query = { ...route.query };
    delete query.szukaj;
    delete query.poziom;
    search.value = "";
    await router.replace({ query, hash: route.hash });
  }
  setOpen(uid, true);
  // The open row has to exist, at its full height, before it is centred.
  await nextTick();
  document
    .getElementById(`u-${uid}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

watch(scope, async (next) => {
  await load(next);
});

watch(
  () => route.hash,
  () => focusTarget(),
);

onMounted(async () => {
  await load(scope.value);
  await focusTarget();
});
</script>

<style scoped>
.users-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
}

.users-controls__search {
  flex: 1 1 280px;
  max-width: 440px;
}
</style>

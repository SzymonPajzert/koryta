<template>
  <v-card class="mb-4" data-testid="person-teaser">
    <div class="pa-4">
      <!-- Headed as the full page heads a person (`EntityDetailsCard`). -->
      <h2 class="text-h5 font-weight-bold">{{ teaser.name }}</h2>

      <!-- The latest post as the first row of the history the full page lists,
           drawn by the card that draws it there - chips, dates and all - so
           the teaser reads as the page it is a piece of. A company nobody has
           published is drawn without a link: following it would be a second
           wall. -->
      <div
        v-if="historyEdges.length > 0"
        class="mt-4"
        data-testid="person-teaser-employment"
      >
        <CardEmploymentHistory :edges="historyEdges" unlink-drafts />
      </div>

      <!-- Under what the reader can see, what they cannot, and the two ways in
           - the site's own login banner. -->
      <ExploreLoginBanner
        :to="loginTarget"
        :signup-to="signupTarget"
        class="mt-4 mb-0"
        @login="onClick('login')"
        @signup="onClick('signup')"
      >
        <div class="font-weight-bold">W trakcie weryfikacji</div>
        <div data-testid="person-teaser-more">{{ noticeText }}</div>
      </ExploreLoginBanner>

      <!-- Said on every teaser: the post comes from the register, and being
           listed here is no political tie. The party a match may have
           suggested is not on this page at all. -->
      <p class="text-caption text-medium-emphasis mt-4 mb-0">
        Informacje pochodzą m.in. z publicznych rejestrów. Obecność w bazie nie
        oznacza powiązań politycznych.
      </p>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { getCurrentUser } from "vuefire";
import type { TeaserClickMode } from "~~/shared/analytics";
import type { Node } from "~~/shared/model";
import type { PersonTeaser } from "~~/shared/personTeaser";
import { trackGoal } from "~/composables/analytics";
import { edgeTypeLabels, type EdgeNode } from "~/composables/edges";
import { polishCounting } from "~/composables/polish";
import { teaserArrival, watchTeaserExit } from "~/composables/teaserJourney";

/** What a logged out reader sees on the page of a person nobody has published:
 * the name, the most recent post, and the way to sign in for the rest. See
 * `shared/personTeaser.ts` for what is left out and why - a party above all. */
const props = defineProps<{
  teaser: PersonTeaser;
  /** The node the url names, which the search box reported picking. Not
   * `teaser.id`, which is the survivor's where the url names a duplicate. */
  nodeId: string;
}>();

const route = useRoute();
const router = useRouter();

const GOAL = { surface: "osoba", kind: "profil" } as const;

/** The post as a row of `CardEmploymentHistory`, made the way `useEdges`
 * makes the full page's rows - the label is the role, or the edge type's own
 * phrase where the register named none. */
const historyEdges = computed<EdgeNode[]>(() => {
  const post = props.teaser.post;
  if (!post) return [];
  return [
    {
      id: post.id,
      type: "employed",
      name: post.name,
      label: post.name || edgeTypeLabels.employed!,
      source: props.teaser.id,
      target: post.company.id,
      start_date: post.start_date,
      end_date: post.end_date,
      richNode: { ...post.company, type: "place" } as Node,
    },
  ];
});

/** Why the rest is held back, and what signing in shows - counting the posts
 * where there are more than the one above. */
const noticeText = computed(() => {
  const count = props.teaser.employmentCount;
  const what =
    count > 1
      ? `${polishCounting(count, "stanowisko", "stanowiska", "stanowisk")}, źródła i graf powiązań`
      : "źródła i graf powiązań";
  return `Zaloguj się, by zobaczyć wszystkie ${what} tej osoby.`;
});

/** Back here once signed in. `powod` tells /login, and `login:success`, why
 * the reader came; `konto=nowe` opens the form on registration. */
const loginTarget = computed(() => ({
  path: "/login",
  query: { redirect: route.fullPath, powod: "profil-osoby" },
}));
const signupTarget = computed(() => ({
  path: "/login",
  query: { ...loginTarget.value.query, konto: "nowe" },
}));

function onClick(mode: TeaserClickMode) {
  trackGoal("teaser:click", { ...GOAL, mode });
}

let stopWatchingExit: (() => void) | undefined;

onMounted(async () => {
  // The server renders every page anonymously, so a signed in reader is shown
  // this for the moment before their page loads. Only a reader who is really
  // logged out has been shown a teaser.
  if (await getCurrentUser()) return;
  trackGoal("teaser:shown", { ...GOAL, from: teaserArrival(props.nodeId) });
  stopWatchingExit = watchTeaserExit(router, route.path, GOAL);
});

onBeforeUnmount(() => stopWatchingExit?.());
</script>

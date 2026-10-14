<template>
  <v-card class="mb-4" data-testid="person-teaser">
    <v-card-item>
      <template #prepend>
        <v-icon :icon="mdiAccountOutline" size="large" />
      </template>
      <v-card-title class="text-h5 text-wrap">{{ teaser.name }}</v-card-title>
      <v-card-subtitle class="text-wrap opacity-100">
        <v-chip size="small" variant="outlined" class="mt-1">
          Profil niezweryfikowany
        </v-chip>
      </v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <!-- The one post, as the full page would list it. The company is a link
           only where its own page is live: a logged out reader sent to a
           company nobody has published would hit the same wall again. -->
      <div
        v-if="employment"
        class="mb-4"
        data-testid="person-teaser-employment"
      >
        <div class="text-overline">
          {{ heldNow ? "Obecne stanowisko" : "Ostatnie stanowisko" }}
        </div>
        <div class="text-subtitle-1 font-weight-bold text-wrap">
          <nuxt-link v-if="companyUrl" :to="companyUrl" class="link-plain">
            {{ employment.companyName }}
          </nuxt-link>
          <span v-else>{{ employment.companyName }}</span>
        </div>
        <div
          v-if="employment.role || period"
          class="text-body-2 text-medium-emphasis"
        >
          {{ [employment.role, period].filter(Boolean).join(" · ") }}
        </div>
      </div>

      <p class="mb-2">
        Ta osoba jest w naszej bazie, ale nikt z zespołu nie sprawdził jeszcze
        jej profilu, więc bez logowania pokazujemy tylko jego fragment.
      </p>
      <p class="mb-4" data-testid="person-teaser-more">{{ moreLine }}</p>

      <v-btn
        color="primary"
        variant="flat"
        :to="loginTarget"
        data-testid="person-teaser-login"
        @click="onLoginClick"
      >
        Zaloguj się, aby zobaczyć więcej
      </v-btn>

      <!-- Said on every teaser, because the page is about a named person and
           nobody has checked it: the post comes from the register, and a
           reader must not take being listed here for a political tie. The
           party a match may have suggested is not on this page at all. -->
      <p class="text-caption text-medium-emphasis mt-4 mb-0">
        Informacje pochodzą m.in. z publicznych rejestrów i nie zostały jeszcze
        sprawdzone przez zespół. Obecność w bazie nie oznacza powiązań
        politycznych.
      </p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { mdiAccountOutline } from "@mdi/js";
import { getCurrentUser } from "vuefire";
import type { PersonTeaser } from "~~/shared/personTeaser";
import { spellDate } from "~~/shared/succession";
import { trackGoal } from "~/composables/analytics";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import { teaserArrival, watchTeaserExit } from "~/composables/teaserJourney";
import { relationPeriodLabel } from "~/utils/relationPeriod";

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

const employment = computed(() => props.teaser.employment);

/** Whether the post is still held: no end, or an end still ahead. */
const heldNow = computed(() => {
  const end = spellDate(employment.value?.end);
  return end === null || end >= Date.now();
});

const period = computed(() => {
  const job = employment.value;
  if (!job) return "";
  if (job.start && !job.end) return `od ${job.start}`;
  return relationPeriodLabel(job.start, job.end);
});

const companyUrl = computed(() => {
  const job = employment.value;
  if (!job?.companyPublished) return undefined;
  return generateEntityUrl("place", job.companyId, job.companyName);
});

/** What signing in gets the reader, counting the posts where there is more
 * than the one above. */
const moreLine = computed(() => {
  const count = props.teaser.employmentCount;
  const posts =
    count > 1
      ? ` - w tym wszystkie ${polishCounting(count, "stanowisko", "stanowiska", "stanowisk")}`
      : "";
  return `Po zalogowaniu zobaczysz cały profil${posts}, ze źródłami i grafem powiązań, i możesz pomóc go sprawdzić.`;
});

/** Back here once signed in. `powod` tells /login, and `login:success`, why
 * the reader came. */
const loginTarget = computed(() => ({
  path: "/login",
  query: { redirect: route.fullPath, powod: "profil-osoby" },
}));

function onLoginClick() {
  trackGoal("teaser:click", GOAL);
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

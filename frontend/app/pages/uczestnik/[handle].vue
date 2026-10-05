<template>
  <div v-if="profile" class="uczestnik w-100 mx-auto">
    <!-- The "stat hero": who, on the left; what they did, as four big
         figures, on the right. A phone stacks the two. -->
    <article class="k-card uczestnik__hero">
      <header class="uczestnik__who">
        <v-avatar
          size="96"
          class="uczestnik__avatar"
          data-testid="uczestnik-avatar"
        >
          <v-img
            v-if="profile.avatar"
            :src="profile.avatar"
            :alt="`Zdjęcie profilowe: ${profile.name}`"
            cover
          />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </v-avatar>
        <p class="uczestnik__kicker">Profil uczestnika</p>
        <h1 class="uczestnik__name">{{ profile.name }}</h1>
        <p v-if="joined" class="uczestnik__joined">
          <v-icon :icon="mdiCalendarMonthOutline" size="16" />
          <span data-testid="uczestnik-joined">{{ joined }}</span>
        </p>
      </header>

      <ul class="uczestnik__counts" aria-label="Aktywność na koryta.pl">
        <li
          v-for="tile in tiles"
          :key="tile.key"
          class="uczestnik__tile"
          data-testid="uczestnik-count"
        >
          <span class="uczestnik__value">{{ polishNumber(tile.value) }}</span>
          <span class="uczestnik__label">
            <span
              class="uczestnik__dot"
              :style="{ backgroundColor: tile.color }"
              aria-hidden="true"
            />
            {{ tile.label }}
          </span>
        </li>
      </ul>
    </article>

    <p class="uczestnik__note">
      To jedna z osób, które jako wolontariusze sprawdzają i uzupełniają dane na
      koryta.pl. Kto ile zrobił w ostatnich tygodniach, widać w
      <NuxtLink to="/eksploruj/statystyki">statystykach</NuxtLink>.
    </p>
  </div>
</template>

<script setup lang="ts">
import { mdiCalendarMonthOutline } from "@mdi/js";
import { nominativeNoun, polishNumber } from "~/composables/polish";
import { activityColors } from "~/utils/chartTheme";
import { monthYear } from "~~/shared/dates";
import { ink } from "~~/shared/colors";
import type { PublicProfile } from "~~/shared/userAdmin";

/** A contributor's public profile.
 *
 * Exists only for somebody who turned `publicProfile` on from /profil, under
 * the handle they chose or were given - never under the uid, which would tie
 * the name to everything stored under it. Everything on it is something the
 * switch's label promised to show and nothing more: the name, their own
 * picture, the month they joined and how much they did. No list of what they
 * rated or proposed, and no role - an administrator's profile reads like
 * anybody else's.
 *
 * Kept out of search engines on both counts - `robots: false` here and the
 * `/uczestnik` disallow in nuxt.config.ts - because a volunteer agreeing to be
 * named on the site is not agreeing to be a search result for their own name.
 * Anything the server will not show is the site's standard 404, the same for a
 * handle nobody holds as for a profile switched off a minute ago.
 */
definePageMeta({
  robots: false,
  // One profile to the next is a new page, not new data in the old one: the
  // not-found check below runs once per setup.
  key: (route) => route.fullPath,
});

const route = useRoute();
const handle = String(route.params.handle ?? "");

const { data: profile, error } = await useFetch<PublicProfile>(
  `/api/profiles/${encodeURIComponent(handle)}`,
  { key: `uczestnik-${handle}` },
);

if (error.value || !profile.value) {
  throw createError({
    statusCode: error.value?.statusCode ?? 404,
    statusMessage: "Nie ma takiego profilu",
    fatal: true,
  });
}

const initials = computed(() =>
  (profile.value?.name ?? "")
    .split(/[\s@.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase())
    .join(""),
);

/** „Na koryta.pl od maja 2026”: `monthYear` gives the genitive the „od”
 * wants. Empty for an account whose creation date the server did not have. */
const joined = computed(() =>
  profile.value?.joined
    ? `Na koryta.pl od ${monthYear(`${profile.value.joined}-01`)}`
    : "",
);

/** The four figures, each with the noun it takes: „12 ocen”, „1 notatka”,
 * „3 propozycje zmian”. The dots are the same colours the ranking and the
 * timeline give these kinds, so a reader coming from /eksploruj/statystyki
 * reads them the same way; an accepted proposal is the one figure there with
 * no kind of its own, and takes the palette's success ink. */
const tiles = computed(() => {
  const counts = profile.value?.counts;
  if (!counts) return [];
  return [
    {
      key: "votes",
      value: counts.votes,
      label: nominativeNoun(counts.votes, "ocena", "oceny", "ocen"),
      color: activityColors.vote,
    },
    {
      key: "notes",
      value: counts.notes,
      label: nominativeNoun(counts.notes, "notatka", "notatki", "notatek"),
      color: activityColors.noteSource,
    },
    {
      key: "proposals",
      value: counts.proposals,
      label: nominativeNoun(
        counts.proposals,
        "propozycja zmiany",
        "propozycje zmian",
        "propozycji zmian",
      ),
      color: activityColors.revision,
    },
    {
      key: "accepted",
      value: counts.accepted,
      label: nominativeNoun(
        counts.accepted,
        "przyjęta",
        "przyjęte",
        "przyjętych",
      ),
      color: ink.success,
    },
  ];
});

useSeoMeta({
  title: () => `${profile.value?.name ?? "Uczestnik"} - uczestnik koryta.pl`,
  description: () =>
    `${profile.value?.name ?? "Uczestnik"} sprawdza i uzupełnia dane na koryta.pl.`,
});
</script>

<style scoped>
.uczestnik {
  max-width: 880px;
}

/* Two columns from a tablet up: the person, on the palette's pale sage, and
   the figures on the card's white. */
.uczestnik__hero {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
}

.uczestnik__hero:hover {
  /* Not a link, so not the hover every other k-card has. */
  border-color: rgba(var(--v-border-color), 0.16);
  box-shadow: none;
}

.uczestnik__who {
  align-items: flex-start;
  background: rgb(var(--v-theme-surface-sage));
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 32px;
}

.uczestnik__avatar {
  background: rgb(var(--v-theme-surface));
  border: 3px solid rgb(var(--v-theme-surface));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  color: rgb(var(--v-theme-ink-sage));
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 16px;
}

.uczestnik__kicker {
  color: rgb(var(--v-theme-ink-sage));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.uczestnik__name {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.uczestnik__joined {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  font-size: 0.875rem;
  gap: 6px;
  margin-top: 8px;
}

.uczestnik__counts {
  display: grid;
  gap: 1px;
  /* The 1px gaps, filled with the hairline colour, are the rules between the
     tiles - no tile draws a border of its own, so none doubles up. */
  background: rgba(var(--v-border-color), 0.12);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.uczestnik__tile {
  background: rgb(var(--v-theme-surface));
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  padding: 28px 32px;
}

.uczestnik__value {
  color: rgb(var(--v-theme-ink-strong));
  font-size: 2.75rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}

.uczestnik__label {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  font-size: 0.875rem;
  gap: 8px;
}

.uczestnik__dot {
  border-radius: 50%;
  flex: 0 0 auto;
  height: 8px;
  width: 8px;
}

.uczestnik__note {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 16px 4px 0;
  max-width: 68ch;
}

@media (max-width: 700px) {
  .uczestnik__hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .uczestnik__who {
    padding: 24px;
  }

  .uczestnik__name {
    font-size: 1.6rem;
  }

  .uczestnik__tile {
    padding: 20px 24px;
  }

  .uczestnik__value {
    font-size: 2.25rem;
  }
}
</style>

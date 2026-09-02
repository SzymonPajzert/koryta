<template>
  <section v-if="failed" class="px-2" data-testid="person-successions-error">
    <div
      class="k-note text-caption text-medium-emphasis d-flex align-center ga-2"
    >
      <v-icon :icon="mdiAlertCircleOutline" size="15" />
      <span>Nie udało się wczytać zmian na stanowiskach. Odśwież stronę.</span>
    </div>
  </section>

  <!-- Nothing found and nothing withheld: no heading either. A section that
       announces itself over empty space reads as a page that failed to load,
       and on most people this is what the register supports. -->
  <PageSection
    v-else-if="!empty"
    title="Zmiany na stanowisku"
    :icon="mdiSwapVertical"
    data-testid="person-successions"
  >
    <template #lead>
      <p class="k-lead" data-testid="person-successions-coverage">
        {{ coverage }}
      </p>

      <!-- Why the section is shorter than the register. Said out loud: 896 of
           6,592 people in the register have a page, so for a logged out reader
           this is often most of what was found. -->
      <p
        v-if="hidden"
        class="k-lead"
        data-testid="person-successions-hidden"
        data-hidden-count="1"
      >
        Nie pokazujemy jeszcze {{ hidden }}
        {{ hidden === 1 ? "zmiany" : "zmian" }} — brakuje strony jednej z osób,
        więc nie nazywamy jej tutaj.
      </p>
    </template>

    <SuccessionChangeCard
      v-for="change in changes"
      :key="change.key"
      :change="change"
    />
  </PageSection>
</template>

<script lang="ts" setup>
import { mdiAlertCircleOutline, mdiSwapVertical } from "@mdi/js";
import { personSuccessionChanges } from "~/utils/succession";
import type { PersonSuccession } from "~~/server/api/edges/successions.get";

const props = defineProps<{
  personId: string;
  personName: string;
  /** This person's own party chips, for their side of a handover. The endpoint
   * names the parties of the *other* side only, because that is the half the
   * page does not already hold. */
  personParties?: string[];
  /** How many relations the history above this section lists, so the coverage
   * line can say "2 z 8" rather than "2". Left out where the caller does not
   * know, and then the line says how many were matched and no more. */
  relationCount?: number;
}>();

// Shared with the "Wcześniej: …" line on each row of the relation history
// above, which reads the same response under the same key - so the two are one
// request. See `usePersonSuccessions`.
const { data, status } = usePersonSuccessions(props.personId);

const failed = computed(() => status.value === "error");
const posts = computed<PersonSuccession[]>(() => data.value?.posts ?? []);
const hidden = computed(() => data.value?.hidden ?? 0);

/** Nothing found and nothing withheld - including while the request is still
 * in flight, which is what keeps a section that may not exist from flashing a
 * heading on a client-side navigation. */
const empty = computed(() => !posts.value.length && !hidden.value);

/* ---------- the cards ---------- */

/** The mapping lives in `app/utils/succession.ts`, because the "Kiedy?" daily
 * draws the same card from the same view-model with its dates withheld. What
 * stays here is the half that is this section's own: the fetch, and the
 * coverage line that explains why it is shorter than the register. */
const changes = computed(() =>
  personSuccessionChanges(posts.value, {
    name: props.personName,
    parties: props.personParties,
  }),
);

/** Handovers are counted per seat, not per card: a post this person both took
 * over and handed on is one relation in the history above and would otherwise
 * be counted twice against it. */
const matched = computed(
  () =>
    new Set(
      posts.value.map(
        (post) => `${post.companyId}|${post.role}|${post.start}|${post.end}`,
      ),
    ).size,
);

/** What the section covers, in the reader's terms rather than ours.
 *
 * The second sentence is the one that matters: a handover is an inference from
 * two filings, so a seat with no card is far more often a seat whose other
 * half the register never recorded than a seat that was newly created. */
const coverage = computed(() => {
  const total = props.relationCount;
  const of =
    total === undefined
      ? ""
      : ` — ${matched.value} z ${total} ${total === 1 ? "powiązania" : "powiązań"}`;
  return (
    `Stanowiska, przy których rejestr wskazuje poprzednika lub następcę${of}. ` +
    "Brak wpisu nie znaczy, że stanowisko było nowe: częściej w rejestrze " +
    "brakuje drugiej strony zmiany."
  );
});
</script>

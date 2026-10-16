<template>
  <client-only>
    <v-btn
      class="wrong-person"
      size="x-small"
      density="comfortable"
      variant="text"
      :color="flagged ? 'warning' : undefined"
      :prepend-icon="mdiAccountAlertOutline"
      @click.stop.prevent="toggle"
    >
      {{ flagged ? "Zgłoszono złe dopasowanie" : "To nie ta osoba" }}
      <v-tooltip activator="parent" location="bottom" max-width="280">
        {{
          flagged
            ? `Cofnij zgłoszenie - fakt jednak dotyczy ${personName}.`
            : `Zgłoś, że ten fakt nie dotyczy ${personName} z bazy, tylko kogoś o tym samym nazwisku.`
        }}
      </v-tooltip>
    </v-btn>
  </client-only>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiAccountAlertOutline } from "@mdi/js";
import { castVoteOnce } from "~/composables/votes";
import { useCurrentUser } from "vuefire";
import { ClientOnly } from "#components";

const {
  id,
  personName,
  reported = 0,
} = defineProps<{
  /** The extraction the flag is about. */
  id: string;
  /** The matched node's name, so the tooltip names who is being disputed. */
  personName: string;
  /** How many people have already flagged this match, off the fact's own vote
   * aggregate. Read from the document the card was rendered from, so showing it
   * costs nothing - unlike `useVotes`, which opens a Firestore listener per
   * card and would open one for every fact in an expanded article group. */
  reported?: number;
}>();

const user = useCurrentUser();
const router = useRouter();
const route = useRoute();

/** This reader's own flag, held locally.
 *
 * The aggregate above says whether anybody has flagged the match; it cannot say
 * whether *this* reader did, and asking would cost the per-card listener the
 * whole point of `reported` is to avoid. Starting from the aggregate means a
 * fact somebody else already flagged reads as flagged, which is the truth the
 * card has to tell - and clicking still toggles this reader's own vote.
 */
const sent = ref<boolean | null>(null);
const flagged = computed(() => sent.value ?? reported > 0);

async function toggle() {
  if (!user.value) {
    router.push({ path: "/login", query: { redirect: route.fullPath } });
    return;
  }
  const next = !flagged.value;
  sent.value = next;
  // 0 rather than a delete: `castVoteOnce` merges into the one vote document
  // this reader has on the fact, and removing it would take their verdict with
  // it.
  await castVoteOnce(id, "wrongPerson", next ? 1 : 0, "extraction");
}
</script>

<style scoped>
/* A flag on a match, not a call to action: sits quietly under the name until
   somebody disagrees with it. */
.wrong-person {
  letter-spacing: normal;
  text-transform: none;
  opacity: 0.75;
}

.wrong-person:hover {
  opacity: 1;
}
</style>

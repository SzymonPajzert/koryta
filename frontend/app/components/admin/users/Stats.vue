<template>
  <div class="ustats" data-user-stats>
    <h3 class="urow-heading">Od założenia konta</h3>
    <div class="ustats__grid">
      <div
        v-for="tile in tiles"
        :key="tile.key"
        class="ustats__tile"
        :data-stat="tile.key"
      >
        <span class="ustats__number">{{ polishNumber(tile.value) }}</span>
        <span class="ustats__label">{{ tile.label }}</span>
        <span v-if="tile.note" class="ustats__note">{{ tile.note }}</span>
      </div>
    </div>

    <p v-if="detail.trial" class="ustats__trial" data-trial-stats>
      <strong>Okres próbny</strong> od
      {{ formatDay(detail.trial.startedAt) }} ({{
        polishCountingGenitive(detail.trial.days, "dnia", "dni")
      }}): propozycje zmian {{ detail.trial.revisions }} · decyzje
      {{ detail.trial.decisions }}
    </p>

    <div class="d-flex flex-wrap ga-2 mt-3" data-user-links>
      <v-chip
        size="small"
        label
        :to="detail.links.revisions"
        :prepend-icon="mdiFileDocumentEditOutline"
      >
        Propozycje zmian
      </v-chip>
      <v-chip
        size="small"
        label
        :to="detail.links.activity"
        :prepend-icon="mdiTimelineClockOutline"
      >
        Aktywność
      </v-chip>
      <v-chip
        v-if="detail.links.profile"
        size="small"
        label
        :to="detail.links.profile"
        :prepend-icon="mdiAccountCircleOutline"
        data-profile-link
      >
        Publiczny profil
      </v-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
/** What an account has done, counted from the day it was created: the numbers
 * a nomination is argued from.
 *
 * Proposals carry their acceptance rate, out of the decided ones only, because
 * that is the figure that says whether somebody's edits can be trusted; a
 * queue of undecided ones says nothing either way. For an administrator on
 * trial, the trial's own proposals and decisions come under it - the part of
 * the record the trial is about. */
import { computed } from "vue";
import {
  mdiAccountCircleOutline,
  mdiFileDocumentEditOutline,
  mdiTimelineClockOutline,
} from "@mdi/js";
import { acceptanceRate } from "~/composables/adminUsers";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import type { AdminUserDetail } from "~~/shared/userAdmin";

const props = defineProps<{ detail: AdminUserDetail }>();

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString("pl-PL", { dateStyle: "medium" });

const tiles = computed(() => {
  const { lifetime } = props.detail;
  const { revisions } = lifetime;
  const rate = acceptanceRate(revisions);
  return [
    { key: "votes", label: "Oceny", value: lifetime.votes },
    { key: "notes", label: "Notatki", value: lifetime.notes },
    {
      key: "revisions",
      label: "Propozycje zmian",
      value: revisions.total,
      note:
        `przyjęte ${revisions.approved} · odrzucone ${revisions.rejected} · ` +
        `czeka ${revisions.pending}` +
        (rate === null ? "" : ` · ${rate}% przyjętych`),
    },
    { key: "decisions", label: "Decyzje", value: lifetime.decisions },
    { key: "feedback", label: "Zgłoszenia", value: lifetime.feedback },
    { key: "qaChecks", label: "Sprawdzenia QA", value: lifetime.qaChecks },
    { key: "comments", label: "Komentarze", value: lifetime.comments },
    { key: "images", label: "Zdjęcia", value: lifetime.images },
  ];
});
</script>

<style scoped>
.ustats__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.ustats__tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-muted));
}

/* The proposals tile carries its split and rate: give it the room of two. */
.ustats__tile[data-stat="revisions"] {
  grid-column: span 2;
}

/* A grid narrow enough for one column would grow a second one for the span,
 * wider than the phone; the whole row is the same two columns or fewer. */
@media (max-width: 599.98px) {
  .ustats__tile[data-stat="revisions"] {
    grid-column: 1 / -1;
  }
}

.ustats__number {
  font-size: 1.375rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.ustats__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-ink-neutral));
}

.ustats__note {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.ustats__trial {
  margin-top: 10px;
  font-size: 0.875rem;
}
</style>

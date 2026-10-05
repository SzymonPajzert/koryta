<template>
  <div class="d-flex flex-column ga-1 py-1">
    <div v-if="proposal.kind === 'removal'" class="text-body-2">
      Powód usunięcia: {{ proposal.deleteReason || "nie podano" }}
    </div>
    <RevisionDiff
      v-else
      :changes="proposal.changes"
      :change-count="proposal.changeCount"
      :max="max"
      :full-comparison-to="fullComparisonTo"
      :wide="wide"
    />

    <!-- Inline, not a tooltip: this is the one warning on the page that stands
         between a reviewer and silently undoing somebody else's work. -->
    <div
      v-if="proposal.stale"
      class="d-flex align-start ga-1 text-caption text-ink-warning"
    >
      <v-icon :icon="mdiAlertOutline" size="x-small" class="mt-1" />
      <span>
        Wpis zmienił się po zgłoszeniu — zatwierdzenie cofnie nowsze zmiany.
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** What one proposal would do, as a queue row reads it.
 *
 * The diff is the usual answer, but two cases are not diffs: a removal, whose
 * whole content is the reason for it, and a proposal filed against a snapshot
 * the entry has since moved past. `applyRevision` writes with `set` rather than
 * `merge`, so approving a stale one really does write the older snapshot over
 * everything that landed since - which is why that says so here rather than in
 * a tooltip somebody could miss.
 */
import { mdiAlertOutline } from "@mdi/js";
import type { Proposal } from "~~/shared/proposals";

defineProps<{
  proposal: Proposal;
  max?: number;
  fullComparisonTo?: string | null;
  /** See `RevisionDiff`: outside a table cell a long value gets the line. */
  wide?: boolean;
}>();
</script>

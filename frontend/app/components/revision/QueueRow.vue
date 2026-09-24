<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`rewizja-${proposal.id}`"
    :tone="statusTone[proposal.status]"
    :highlighted="highlighted"
    data-proposal-row
    :data-proposal-id="proposal.id"
  >
    <template #summary>
      <RevisionRowLine>
        <v-icon
          class="flex-0-0"
          size="small"
          :icon="statusIcons[proposal.status]"
          :class="`text-ink-${statusTone[proposal.status]}`"
        />
        <span class="d-sr-only">{{ statusLabel }}:</span>
        <v-icon
          class="flex-0-0 text-medium-emphasis"
          size="small"
          :icon="targetIcon"
        />
        <span class="arow-grow font-weight-medium" :title="name">
          {{ name }}
        </span>
        <span v-if="kindTag" class="arow-tag" :class="kindTag.classes">
          {{ kindTag.label }}
        </span>
        <template #rest>
          <span
            v-if="fields"
            class="arow-side text-body-2 text-medium-emphasis"
            :title="fields"
          >
            {{ fields }}
          </span>
          <span class="arow-side text-body-2" :title="who">{{ who }}</span>
          <span class="arow-fixed text-caption text-medium-emphasis">
            {{ formatDaysAgo(proposal.updateTime) }}
          </span>
        </template>
      </RevisionRowLine>
    </template>

    <template #meta>
      <AdminRowFact label="Autor">
        <UserChip :uid="proposal.updateUser" :user="proposal.author" />
      </AdminRowFact>
      <AdminRowFact label="Kiedy">
        {{ formatMoment(proposal.updateTime) }} ·
        {{ formatDaysAgo(proposal.updateTime) }}
      </AdminRowFact>
      <AdminRowFact label="Rodzaj">
        {{ proposal.automatic ? "Pipeline" : "Od człowieka" }}
      </AdminRowFact>
      <AdminRowFact label="Status">
        <span :title="proposalStatusHints[proposal.status]">
          {{ statusLabel }}
        </span>
        <!-- The chip elsewhere says „odczytany”; here the pane is too plain for
             a chip, so the same caveat is spelled out. -->
        <span v-if="proposal.statusDerived"> (odczytany z wpisu)</span>
      </AdminRowFact>
      <AdminRowFact v-if="proposal.reviewTime" label="Rozpatrzono">
        {{ formatMoment(proposal.reviewTime) }}
      </AdminRowFact>
      <AdminRowFact
        v-if="proposal.status === 'rejected' && proposal.rejectReason"
        label="Powód odrzucenia"
      >
        {{ proposal.rejectReason }}
      </AdminRowFact>
    </template>

    <div class="d-flex flex-column ga-3">
      <RevisionTargetCell :proposal="proposal" />
      <RevisionChangeCell :proposal="proposal" />
      <!-- A pipeline uid has tens of thousands of revisions, and the per-author
           scan stops at 500, so "everything from this author" is only offered
           for a person. -->
      <div v-if="canFocusAuthor">
        <v-btn
          variant="text"
          size="small"
          color="ink-sage"
          :prepend-icon="mdiAccountSearchOutline"
          data-focus-author
          @click="emit('focus-author', proposal.updateUser)"
        >
          Wszystko od tej osoby
        </v-btn>
      </div>
    </div>

    <template #footer>
      <RevisionReviewActions
        :proposal="proposal"
        :reviewable="proposal.status === 'pending'"
        :loading="loading"
        :full-comparison-to="comparisonTo"
        @approve="emit('approve', $event)"
        @reject="emit('reject')"
        @permalink="emit('permalink')"
      />
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
/** One proposal in the review queue on /admin/rewizje, as a line that opens.
 *
 * The line says what a reviewer sorts by - where it stands, what it is filed
 * against, what kind of change, which fields, who, how long ago - and the open
 * row holds what they decide with: the diff, the entry it lands on, and the
 * decisions themselves. The queue used to send every row to the comparison
 * page for that, one button per row, because a table cell had no room for five
 * buttons; an open row has.
 */
import { computed } from "vue";
import {
  mdiAccountSearchOutline,
  mdiCheckDecagramOutline,
  mdiClockOutline,
  mdiCloseCircleOutline,
  mdiHistory,
  mdiVectorPolyline,
} from "@mdi/js";
import type { RowTone } from "~/composables/rowTone";
import { entityIcon } from "~/utils/entityIcon";
import { formatDaysAgo } from "~/utils/chartTheme";
import {
  proposalStatusHints,
  proposalStatusLabels,
  type Proposal,
  type ProposalStatus,
} from "~~/shared/proposals";

const props = defineProps<{
  proposal: Proposal;
  /** Where a permalink landed. */
  highlighted?: boolean;
  /** A decision on this one is on its way to the server. */
  loading?: boolean;
  /** The queue is already narrowed to this author, so the way to narrow it
   * would be a button that does nothing. */
  authorFocused?: boolean;
}>();

const emit = defineEmits<{
  approve: [options: { publish: boolean }];
  reject: [];
  permalink: [];
  "focus-author": [uid: string];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const statusTone: Record<ProposalStatus, RowTone> = {
  pending: "warning",
  approved: "success",
  superseded: "neutral",
  rejected: "danger",
};

/** The icons `ChipRevisionStatus` puts on the same four states, so the line and
 * the chips on /profil and on an entry's page read alike. */
const statusIcons: Record<ProposalStatus, string> = {
  pending: mdiClockOutline,
  approved: mdiCheckDecagramOutline,
  superseded: mdiHistory,
  rejected: mdiCloseCircleOutline,
};

const statusLabel = computed(
  () => proposalStatusLabels[props.proposal.status].label,
);

const targetIcon = computed(() =>
  props.proposal.targetCollection === "edges"
    ? mdiVectorPolyline
    : entityIcon(props.proposal.targetType ?? undefined),
);

/** The same fallback `RevisionTargetCell` prints, so the line and the open row
 * name a missing target alike. */
const name = computed(
  () =>
    props.proposal.targetName ??
    (props.proposal.targetExists ? props.proposal.targetId : "Usunięty wpis"),
);

/** One word for what kind of change this is, when it is not a plain edit. A
 * removal says so before anything else: approving it takes a page down. */
const kindTag = computed(() => {
  const proposal = props.proposal;
  if (proposal.kind === "removal") {
    return {
      label: "Usunięcie",
      classes: "bg-surface-danger text-ink-danger",
    };
  }
  if (proposal.targetCollection === "edges") {
    return { label: "Powiązanie", classes: "bg-surface-info text-ink-info" };
  }
  if (proposal.kind === "create") {
    return { label: "Nowy wpis", classes: "bg-surface-sage text-ink-sage" };
  }
  return null;
});

/** Which fields it touches, by their Polish names. A removal changes nothing
 * field by field - its content is the reason given for it. */
const fields = computed(() => {
  const proposal = props.proposal;
  if (proposal.kind === "removal") return proposal.deleteReason ?? "";
  if (proposal.changeCount === 0) return "bez zmian";
  const more = proposal.changeCount - proposal.changes.length;
  const text =
    proposal.changes.map((change) => change.label).join(", ") +
    (more > 0 ? ` +${more}` : "");
  return text.charAt(0).toUpperCase() + text.slice(1);
});

/** Plain text on the line - a `UserChip` is a chip, and the line is the inside
 * of a button. The open row has the chip. */
const who = computed(() => {
  const proposal = props.proposal;
  if (proposal.automatic) return "pipeline";
  return (
    proposal.author?.displayName ||
    proposal.author?.email ||
    proposal.updateUser ||
    "nieznany autor"
  );
});

const canFocusAuthor = computed(
  () =>
    !props.proposal.automatic &&
    !!props.proposal.updateUser &&
    !props.authorFocused,
);

/** The side-by-side view, which only exists for nodes. */
const comparisonTo = computed(() =>
  props.proposal.targetCollection === "nodes" && props.proposal.targetId
    ? `/admin/rewizje/${props.proposal.targetId}?revisionId=${props.proposal.id}`
    : null,
);

const formatMoment = (value: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";
</script>

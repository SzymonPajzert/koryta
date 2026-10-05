<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`wpis-${node.id}`"
    :tone="waiting ? 'warning' : 'neutral'"
    data-node-row
    :data-node-id="node.id"
  >
    <template #summary>
      <RevisionRowLine>
        <v-icon
          class="flex-0-0"
          size="small"
          :icon="entityIcon(node.type)"
          :class="waiting ? 'text-ink-warning' : 'text-ink-neutral'"
        />
        <span class="arow-grow font-weight-medium" :title="name">
          {{ name }}
        </span>
        <span class="arow-side text-body-2 text-medium-emphasis">
          {{ typeLabel }}
        </span>
        <span
          v-if="waiting"
          class="arow-tag bg-surface-warning text-ink-warning"
          data-waiting
        >
          czeka
        </span>
        <template #rest>
          <span class="arow-fixed text-body-2" data-revision-count>
            {{ revisionCount }}
          </span>
          <span class="arow-fixed text-caption text-medium-emphasis">
            {{ formatDaysAgo(node.revisions?.latest_time) }}
          </span>
        </template>
      </RevisionRowLine>
    </template>

    <template #actions>
      <v-btn
        icon
        variant="text"
        size="small"
        :to="`/admin/rewizje/${node.id}`"
        aria-label="Porównanie obok siebie"
        data-compare-link
      >
        <v-icon :icon="mdiCompare" size="small" />
        <v-tooltip activator="parent" location="bottom">
          Porównanie obok siebie
        </v-tooltip>
      </v-btn>
    </template>

    <template #meta>
      <AdminRowFact label="Stan">
        {{ waiting ? "czeka na akceptację" : "wszystko zaakceptowane" }}
      </AdminRowFact>
      <AdminRowFact label="Ostatnia zmiana">
        {{ formatMoment(node.revisions?.latest_time) }} ·
        {{ formatDaysAgo(node.revisions?.latest_time) }}
      </AdminRowFact>
      <AdminRowFact v-if="node.visibility !== undefined" label="Strona">
        {{ node.visibility ? "opublikowana" : "nieopublikowana" }}
      </AdminRowFact>
    </template>

    <div class="d-flex flex-column ga-2">
      <div>
        <v-btn
          variant="text"
          size="small"
          color="ink-sage"
          :prepend-icon="mdiOpenInNew"
          :to="entityUrl"
        >
          Strona wpisu
        </v-btn>
      </div>
      <RevisionHistoryList
        :node-id="node.id"
        embedded
        @changed="emit('changed')"
      />
    </div>
  </AdminExpandRow>
</template>

<script setup lang="ts">
/** One entry with a history, on /admin/rewizje, as a line that opens into that
 * history.
 *
 * The line says whether anything on the entry is still waiting, how many
 * revisions it has and when the last one came; the open row lists them, with
 * who wrote each - which the table this replaces never said at all. The wide
 * side-by-side table is one click away on the line itself, for when the list
 * is not enough.
 */
import { computed } from "vue";
import { mdiCompare, mdiOpenInNew } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import { formatDaysAgo } from "~/utils/chartTheme";
import { nodeLinkUrl } from "~/composables/slugs";
import { polishCounting } from "~/composables/polish";
import type { NodeType } from "~~/shared/model";

/** A row of `/api/nodes/revisions`. The endpoint sends the whole node; these
 * are the fields the list reads. */
export type RevisedNode = {
  id: string;
  name: string;
  type: NodeType;
  /** Whether the page is public, worked out by the endpoint. */
  visibility?: boolean;
  revisions?: {
    total: number;
    latest_time: string | null;
    has_unapproved: boolean;
  };
};

const props = defineProps<{
  node: RevisedNode;
  typeLabel: string;
}>();

const emit = defineEmits<{
  /** Something in the history was decided on, so the counts on the line - and
   * anything else on the page that lists the same revisions - are stale. */
  changed: [];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const waiting = computed(() => props.node.revisions?.has_unapproved === true);

const name = computed(() => props.node.name || props.node.id);

const revisionCount = computed(() =>
  polishCounting(
    props.node.revisions?.total ?? 0,
    "rewizja",
    "rewizje",
    "rewizji",
  ),
);

const entityUrl = computed(() =>
  nodeLinkUrl({ id: props.node.id, type: props.node.type, name: name.value }),
);

const formatMoment = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";
</script>

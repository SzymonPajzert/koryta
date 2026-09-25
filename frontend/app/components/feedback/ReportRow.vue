<template>
  <!-- The id is what the "Otwórz w panelu" button in Slack links to.

       A settled report is greyed rather than hidden: one closed from its row
       stays where it was until the next load (see `feedbackSection`), and the
       closed ones are the record of what was asked for. Hover and keyboard
       focus bring it back to full contrast, so it stays readable and its
       status select stays usable. -->
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`fb-${item.id}`"
    class="fb-report"
    :tone="feedbackKindTone[item.kind]"
    :dimmed="isSettled(item)"
    :highlighted="highlighted"
    :data-feedback-id="item.id"
    data-report-row
  >
    <template #summary>
      <span
        v-if="position"
        class="arow-fixed text-body-2 font-weight-bold"
        data-queue-position
      >
        #{{ position }}
      </span>
      <FeedbackOrderRowSummary :item="item" :fix-state="fix?.state" />
    </template>

    <!-- Deciding that a report is worth doing should not take opening it: the
         line is usually enough to judge by, and the end of the queue always
         has room, whatever the rows around it say. -->
    <template v-if="canQueue" #actions>
      <v-btn
        icon
        size="small"
        variant="text"
        color="ink-sage"
        aria-label="Do kolejki"
        title="Do kolejki"
        @click="emit('queue')"
      >
        <v-icon :icon="mdiPlaylistPlus" />
      </v-btn>
    </template>

    <template #meta>
      <AdminRowFact label="Rodzaj">
        {{ feedbackKindConfig[item.kind].title }}
      </AdminRowFact>
      <AdminRowFact label="Kiedy">
        <!-- A link to the row itself, so its id can be copied: the same
             #fb-<id> anchor Slack's "Otwórz w panelu" uses, and what a QA
             entry names in `fixes`. -->
        <a
          :href="reportPage ? `${reportPage}#fb-${item.id}` : `#fb-${item.id}`"
          class="fb-report__permalink"
          title="Link do tego zgłoszenia"
        >
          {{ formatFeedbackDate(item.createdAt) }}
        </a>
      </AdminRowFact>
      <AdminRowFact label="Autor">
        <UserChip v-if="item.userUid" :uid="item.userUid" />
        <template v-else>anonimowo</template>
      </AdminRowFact>
      <AdminRowFact v-if="item.contact" label="Kontakt">
        {{ item.contact }}
      </AdminRowFact>
      <AdminRowFact label="Status">
        {{ feedbackStatusConfig[item.adminStatus].title }}
      </AdminRowFact>
    </template>

    <p class="fb-report__message text-body-1 mb-3">{{ item.message }}</p>

    <div class="d-flex align-center flex-wrap ga-2">
      <!-- A verdict left on a QA changelog entry arrives here like any other
           report; what it needs is the entry it was about, not the /qa route
           every one of them carries. -->
      <template v-if="item.context.qa">
        <v-chip
          size="x-small"
          label
          color="ink-info"
          :to="`/qa#qa-${item.context.qa.itemId}`"
        >
          <v-icon start :icon="mdiClipboardCheckOutline" />
          QA: {{ item.context.qa.title }}
        </v-chip>
        <v-chip
          size="x-small"
          label
          variant="tonal"
          :color="
            item.context.qa.status === 'ok' ? 'ink-success' : 'ink-danger'
          "
        >
          {{ qaStatusLabels[item.context.qa.status] }}
        </v-chip>
      </template>
      <v-chip v-else size="x-small" label :to="feedbackPageLink(item)">
        <v-icon start :icon="mdiLinkVariant" />
        {{ item.context.pageTitle || item.context.route }}
      </v-chip>
      <!-- A change on the QA list says it fixes this report. -->
      <FeedbackFixChip
        v-if="fix"
        :entries="fix.entries"
        :state="fix.state"
        :verdicts="fix.verdicts"
        :blocked="fix.blocked"
        :follow-ups="fix.followUps"
        :reporter-uid="item.userUid"
        :report-page="reportPage"
      />
      <!-- This report was written while checking such a change: the way back
           to what the change was fixing. -->
      <v-chip
        v-for="target in fixTargets ?? []"
        :key="target.id"
        size="x-small"
        label
        variant="outlined"
        :to="feedbackReportLink(target.id!, reportPage)"
        :title="target.message"
        data-fix-target
      >
        <v-icon start :icon="mdiArrowULeftTop" />
        dotyczy zgłoszenia
      </v-chip>
      <v-chip
        v-if="item.slack?.state === 'failed'"
        size="x-small"
        label
        color="ink-warning"
        variant="tonal"
      >
        nie trafiło na Slacka
      </v-chip>
    </div>

    <template #footer>
      <v-btn
        v-if="fix?.close"
        size="small"
        variant="tonal"
        color="ink-success"
        :prepend-icon="mdiCheckAll"
        :loading="saving"
        @click="emit('status', 'resolved')"
      >
        Zamknij jako załatwione
      </v-btn>
      <v-select
        class="fb-report__status"
        :model-value="item.adminStatus"
        :items="statusOptions"
        label="Status"
        density="compact"
        variant="outlined"
        hide-details
        :loading="saving"
        @update:model-value="(value: FeedbackStatus) => emit('status', value)"
      />
      <v-textarea
        class="fb-report__note"
        :model-value="item.adminNote ?? ''"
        label="Notatka"
        density="compact"
        variant="outlined"
        rows="1"
        auto-grow
        hide-details
        :loading="saving"
        @update:model-value="(value: string) => emit('draft', value)"
        @blur="emit('saveNote')"
      />
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import {
  mdiArrowULeftTop,
  mdiCheckAll,
  mdiClipboardCheckOutline,
  mdiLinkVariant,
  mdiPlaylistPlus,
} from "@mdi/js";
import {
  feedbackKindConfig,
  feedbackKindTone,
  feedbackReportLink,
  feedbackStatusConfig,
} from "~/composables/feedback";
import {
  feedbackPageLink,
  formatFeedbackDate,
  type FixInfo,
} from "~/composables/feedbackAdmin";
import { isSettled } from "~~/shared/feedbackQueue";
import { qaStatusLabels } from "~~/shared/qa";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

/** One report in an admin list: a line to tell it from the others, and in
 * the open row everything there is to know about it and to decide on it -
 * who wrote it and where, the whole message, what the QA list says about it,
 * its status and the team's note.
 *
 * The row decides nothing itself. Every change is an event, and the page
 * makes it through `useFeedbackAdmin`, which is what keeps the writes in
 * order and puts a refused one back. */
defineProps<{
  item: Feedback;
  /** Place in the whole queue, when the report is in it. */
  position?: number;
  /** What the QA list says about a fix for this report, if it claims one. */
  fix?: FixInfo;
  /** The reports this one was written about, when it came from checking a
   * fix for them. */
  fixTargets?: Feedback[];
  /** Offer "Do kolejki" on the line - for a report outside the queue. */
  canQueue?: boolean;
  /** A status or note of this report is being written. */
  saving?: boolean;
  /** The report the url points at. */
  highlighted?: boolean;
  /** The page that lists every report, when this one does not - links to
   * other reports go there. See `feedbackReportLink`. */
  reportPage?: string;
}>();

const emit = defineEmits<{
  /** Put it at the end of the queue. */
  queue: [];
  status: [status: FeedbackStatus];
  /** The note as typed so far. */
  draft: [note: string];
  /** The note field was left: save it if it changed. */
  saveNote: [];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const statusOptions = Object.entries(feedbackStatusConfig).map(
  ([value, { title }]) => ({ title, value }),
);
</script>

<style scoped>
.fb-report__message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* The date is the report's permalink. It keeps the colour of the facts
 * around it and says it is a link by its underline. */
.fb-report__permalink {
  color: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.fb-report__status {
  flex: 0 1 200px;
  min-width: 160px;
}

.fb-report__note {
  flex: 1 1 260px;
  min-width: 0;
}

/* On a phone the line breaks in two, the message under the rest - see
 * `FeedbackOrderRowSummary`, which lays its own part out for that. */
@media (max-width: 599.98px) {
  .fb-report :deep(.arow__toggle) {
    flex-wrap: wrap;
    row-gap: 0;
  }
}
</style>

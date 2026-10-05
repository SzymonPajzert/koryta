<template>
  <!-- Every link in the menu closes it: the default content-click behaviour,
       which also leaves Enter on a link alone (with it off, VMenu swallows
       Enter and a keyboard user cannot follow anything in here). -->
  <v-menu location="bottom start">
    <template #activator="{ props: menu }">
      <v-chip
        v-bind="menu"
        size="x-small"
        label
        variant="tonal"
        :color="state ? fixStateConfig[state].color : 'ink-neutral'"
        :data-fix-state="state ?? 'loading'"
        :title="`Poprawka: ${latest.title}`"
      >
        <v-icon
          start
          :icon="state ? fixStateConfig[state].icon : mdiWrenchOutline"
        />
        Poprawka{{ state ? `: ${fixStateConfig[state].label}` : "" }}
      </v-chip>
    </template>

    <v-card max-width="440" data-fix-details>
      <v-card-text>
        <div class="text-caption text-medium-emphasis mb-1">
          Wpis na liście QA, który to poprawia
        </div>
        <NuxtLink
          :to="`/qa#qa-${latest.id}`"
          class="text-body-2 font-weight-medium"
        >
          {{ latest.title }}
        </NuxtLink>

        <div class="text-caption text-medium-emphasis mt-3 mb-1">
          Co napisali sprawdzający
        </div>
        <div v-if="state === null" class="text-body-2">Wczytuję…</div>
        <div v-else-if="verdicts.length === 0" class="text-body-2">
          Nikt jeszcze nie sprawdził.
        </div>
        <template v-else>
          <div
            v-for="verdict in verdicts"
            :key="verdict.userUid"
            class="d-flex align-start ga-2 mb-1"
            data-fix-verdict
            @click.stop
          >
            <v-icon
              size="small"
              class="mt-1"
              :icon="verdict.status === 'ok' ? mdiCheck : mdiAlertCircleOutline"
              :color="verdict.status === 'ok' ? 'ink-success' : 'ink-danger'"
            />
            <div class="text-body-2">
              <UserChip :uid="verdict.userUid" />
              <span v-if="verdict.userUid === reporterUid" class="text-caption">
                (zgłaszający)
              </span>
              <div>
                {{ verdict.feedback || qaStatusLabels[verdict.status] }}
              </div>
            </div>
          </div>
        </template>

        <template v-if="followUps.length > 0">
          <div class="text-caption text-medium-emphasis mt-3 mb-1">
            Zgłoszenia po poprawce
          </div>
          <!-- Green and yet no "Zamknij": this is the one place that says
               why, so it is said here rather than left to be worked out. -->
          <div
            v-if="blocked"
            class="text-caption text-ink-danger mb-1"
            data-fix-blocked
          >
            Zamknąć będzie można, gdy te zgłoszenia problemu zostaną zamknięte.
          </div>
          <div class="d-flex flex-wrap ga-1">
            <v-chip
              v-for="followUp in followUps"
              :key="followUp.id"
              size="x-small"
              label
              :color="blocksClosing(followUp) ? 'ink-danger' : undefined"
              :to="reportLink(followUp.id!)"
              :title="followUp.message"
            >
              {{ qaStatusLabels[followUp.context.qa!.status] }} ·
              {{ feedbackStatusConfig[followUp.adminStatus].title }}
            </v-chip>
          </div>
        </template>

        <template v-if="entries.length > 1">
          <div class="text-caption text-medium-emphasis mt-3 mb-1">
            Wcześniejsze poprawki
          </div>
          <div v-for="entry in entries.slice(1)" :key="entry.id">
            <NuxtLink :to="`/qa#qa-${entry.id}`" class="text-body-2">
              {{ entry.title }}
            </NuxtLink>
          </div>
        </template>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiAlertCircleOutline, mdiCheck, mdiWrenchOutline } from "@mdi/js";
import {
  feedbackReportLink,
  feedbackStatusConfig,
  fixStateConfig,
} from "~/composables/feedback";
import { blocksClosing, type FixState } from "~~/shared/feedbackFixes";
import type { Feedback } from "~~/shared/model";
import { qaStatusLabels, type QaCheck, type QaItem } from "~~/shared/qa";

/** The QA entry that says it fixes a report, and what the people who checked
 * it found - folded into one chip, because on most reports the colour is all
 * there is to read. The rest opens on a click. The page works out the state,
 * since it also decides the "Zamknij" button and the icon on the row's line;
 * this only shows it. */
const props = defineProps<{
  /** Entries claiming the report, newest first. The newest one decides:
   * an older one is a fix that was itself fixed. */
  entries: QaItem[];
  /** `null` until the verdicts have arrived - until then every fix would read
   * as unchecked, so the chip says nothing about it instead. */
  state: FixState | null;
  /** Everybody's verdicts on the newest entry, newest first. */
  verdicts: QaCheck[];
  /** Reports written while checking the claiming entries. */
  followUps: Feedback[];
  /** Who wrote the report, so their own verdict can be told apart. */
  reporterUid?: string;
  /** The fix works, the report is still open, and a problem reported against
   * the fix is too - what keeps "Zamknij jako załatwione" off the row. */
  blocked?: boolean;
  /** The page the follow-up reports are opened on - see `feedbackReportLink`. */
  reportPage?: string;
}>();

const latest = computed(() => props.entries[0]!);

const reportLink = (id: string) => feedbackReportLink(id, props.reportPage);
</script>

<template>
  <v-chip
    v-if="capture"
    :color="chip.color"
    size="small"
    variant="tonal"
    :prepend-icon="chip.icon"
    :append-icon="factsLink ? mdiArrowRight : undefined"
    :to="factsLink"
  >
    {{ chip.label }}
    <v-tooltip activator="parent" location="top">
      {{ tooltip }}
    </v-tooltip>
  </v-chip>
  <span v-else class="text-medium-emphasis text-caption">—</span>
</template>

<script setup lang="ts">
/** How far a captured article got, in one chip.
 *
 * The distinction that matters on `/zrodla` is not really the status but the
 * outcome: a page can be `done` and still have produced nothing, which is a
 * perfectly good result and looks nothing like a failure.
 */
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiCheckCircleOutline,
  mdiFileDocumentOutline,
  mdiProgressClock,
} from "@mdi/js";
import type { ArticleCapture } from "~~/shared/capture";

const props = defineProps<{ capture?: ArticleCapture }>();

/** Where the facts this capture produced can be read, or nothing.
 *
 * Only offered when there is something at the other end: a capture that is
 * still running, failed, or found nothing would otherwise link to an empty
 * list. `articleUrl` on a fact is the url the extractor was handed, which is
 * this same string.
 */
const factsLink = computed(() => {
  const capture = props.capture;
  if (capture?.status !== "done" || !capture.extraction?.factCount) {
    return undefined;
  }
  return { path: "/ekstrakcje", query: { article: capture.url } };
});

const chip = computed(() => {
  const capture = props.capture;
  if (!capture) return { label: "", color: undefined, icon: undefined };

  switch (capture.status) {
    case "stored":
      return {
        label: "zapisany",
        color: "grey",
        icon: mdiFileDocumentOutline,
      };
    case "extracting":
      return { label: "przetwarzam", color: "info", icon: mdiProgressClock };
    case "error":
      return { label: "błąd", color: "error", icon: mdiAlertCircleOutline };
    case "done": {
      const facts = capture.extraction?.factCount ?? 0;
      return {
        label: facts ? `${facts} ${factWord(facts)}` : "bez faktów",
        color: facts ? "success" : "grey",
        icon: mdiCheckCircleOutline,
      };
    }
    default:
      return { label: capture.status, color: "grey", icon: undefined };
  }
});

function factWord(count: number): string {
  if (count === 1) return "fakt";
  const rest = count % 10;
  const teens = count % 100;
  return rest >= 2 && rest <= 4 && (teens < 12 || teens > 14)
    ? "fakty"
    : "faktów";
}

const tooltip = computed(() => {
  const capture = props.capture;
  if (!capture) return "";
  if (capture.status === "error") {
    return capture.extraction?.error || "Ekstrakcja się nie powiodła.";
  }

  const parts = [
    capture.source === "paste" ? "Wklejony ręcznie" : "Z rozszerzenia",
    `${Math.round(capture.htmlBytes / 1024)} kB`,
  ];
  const score = capture.extraction?.koryciarskiScore;
  if (score !== undefined && score !== null) {
    parts.push(`koryciarstwo ${score}/5`);
  }
  if (capture.extraction?.model) parts.push(capture.extraction.model);
  return parts.join(" · ");
});
</script>

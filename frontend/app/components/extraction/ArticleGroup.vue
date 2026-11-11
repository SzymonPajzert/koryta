<template>
  <!-- A line of the quiet rail: which site, which article, how many facts.
       The path is the part that gives way: it takes what the domain and the
       count leave and ellipsises. The domain keeps its own width, up to the
       rail's cap for a side part (a third of the line, nearly half on a
       phone), and ellipsises only past that - it is how a reviewer tells one
       row from the next, and shrinking in step with a 400px slug left a
       phone „7d…” on rows that then read the same. The count never shrinks.
       One line either way, not a two-line clamp of a slug broken
       mid-word. -->
  <AdminExpandRow v-model:expanded="expanded">
    <template #summary>
      <span class="arow-side article-domain text-body-2">
        {{ shownDomain }}
      </span>
      <span
        class="arow-grow text-body-2 text-medium-emphasis"
        :title="articlePath"
      >
        {{ articlePath }}
      </span>
      <span class="arow-fixed text-body-2 text-medium-emphasis">
        {{ countLabel }}
      </span>
    </template>

    <!-- The row renders its body only while open, so a group's cards and
         their vote listeners still mount when it is opened and not before -
         collapsed groups spin up no Firestore listeners. -->
    <div class="article-facts">
      <ExtractionCard
        v-for="fact in facts"
        :key="fact.id ?? fact.url"
        :fact="fact"
        can-promote
      >
        <template #actions>
          <ExtractionVoteButtons v-if="fact.id" :id="fact.id" />
        </template>
      </ExtractionCard>
    </div>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { ExtractionFact } from "~~/shared/model";
import { ExtractionVoteButtons } from "#components";
import { polishCountingGrouped } from "~/composables/polish";

const props = defineProps<{
  url: string;
  domain: string;
  facts: ExtractionFact[];
}>();

const expanded = ref(false);

const parsedUrl = computed(() => {
  try {
    // Stored URLs may lack a protocol ("tvn24.pl/polska/...").
    return new URL(
      props.url.includes("://") ? props.url : `https://${props.url}`,
    );
  } catch {
    return undefined;
  }
});

/** The domain the uploader recorded, or the url's own host where it recorded
 * none - an empty start of the line would leave the row unnamed. */
const shownDomain = computed(
  () => props.domain || parsedUrl.value?.hostname || "",
);

// The domain leads the line, so the path after it leaves it out.
const articlePath = computed(() =>
  parsedUrl.value
    ? parsedUrl.value.pathname + parsedUrl.value.search
    : props.url,
);

const countLabel = computed(() =>
  polishCountingGrouped(props.facts.length, "fakt", "fakty", "faktów"),
);
</script>

<style scoped>
/* The line's name - semibold, as a fact's far end is on a person's page.
   It does not shrink: the rail's `.arow-side` lets a side part give way in
   proportion to its width, which against a long path cut the domain to a few
   letters. Its `max-width` still caps it, and past that it ellipsises. */
.article-domain {
  flex-shrink: 0;
  font-weight: 600;
}

.article-facts {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>

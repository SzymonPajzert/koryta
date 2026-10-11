<template>
  <BlogEmbedError
    v-if="!embed.success"
    name="composition"
    :errors="embed.errors"
  />
  <figure v-else class="my-6" data-testid="blog-composition">
    <p v-if="embed.data.title" class="text-subtitle-1 font-weight-medium mb-2">
      {{ embed.data.title }}
    </p>
    <StatsCompositionBar :segments="segments" :summary="summary" />
    <figcaption
      v-if="embed.data.source"
      class="text-caption text-medium-emphasis mt-2"
    >
      Źródło: {{ embed.data.source }}
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { readableInkOn } from "~~/shared/colors";
import { categorical, formatCount } from "~/utils/chartTheme";
import type { CompositionSegment } from "~/components/stats/CompositionBar.vue";

/** `::composition` - the parts of a whole as one bar, every number spelled
 * out in the legend under it. Segments take the categorical slots in order,
 * as a chart's series do. */
defineOptions({ inheritAttrs: false });

const embed = useBlogEmbed("composition");

const segments: CompositionSegment[] = embed.success
  ? embed.data.segments.map((segment, i) => ({
      key: segment.label,
      label: segment.label,
      value: segment.value,
      color: categorical[i]!,
      labelColor: readableInkOn(categorical[i]!),
    }))
  : [];

const summary = embed.success
  ? (embed.data.summary ??
    `${embed.data.title ?? "Podział"}: ${segments
      .map((s) => `${s.label} ${formatCount(s.value)}`)
      .join(", ")}`)
  : "";
</script>

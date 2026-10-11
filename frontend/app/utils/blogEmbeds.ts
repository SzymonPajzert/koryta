import type { Component } from "vue";
import type { BlogEmbedName } from "~~/shared/blog";
import BlogCallout from "~/components/blog/Callout.vue";
import BlogChart from "~/components/blog/Chart.vue";
import BlogComposition from "~/components/blog/Composition.vue";
import BlogEntity from "~/components/blog/Entity.vue";
import BlogStats from "~/components/blog/Stats.vue";

/** The component behind each name a post can write - `::chart` is BlogChart.
 *
 * Handed to the renderer as a map rather than left to resolve by name: the
 * renderer only reaches components registered globally or used by a post at
 * build time, and a post kept anywhere but content/ would be neither. Typed
 * by `BlogEmbedName`, so an embed added to the schema without a component
 * here does not compile. */
export const blogEmbedComponents: Record<BlogEmbedName, Component> = {
  callout: BlogCallout,
  chart: BlogChart,
  composition: BlogComposition,
  entity: BlogEntity,
  stats: BlogStats,
};

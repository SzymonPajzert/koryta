import type { QueueTierStats } from "~~/server/api/stats/queueTiers.get";

/** How many unpublished people are in each difficulty tier, and a published
 * example or three of each.
 *
 * One `useAsyncData` key for the whole site, like `useStats`, so a page
 * rendering the three tiers in two places still asks once; /api/stats/queueTiers
 * is cached on top of that.
 *
 * Empty until the request lands, and a tier's `toCheck` can stay null after it
 * - see the endpoint. Callers render no number in that case rather than a
 * zero.
 */
export const useQueueTiers = () => {
  const { data } = useAsyncData("queue-tiers", () =>
    $fetch<QueueTierStats>("/api/stats/queueTiers"),
  );

  return { tiers: computed(() => data.value?.tiers ?? []) };
};

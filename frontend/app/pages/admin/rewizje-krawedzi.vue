<template>
  <div />
</template>

<script setup lang="ts">
/** The pending edge revisions moved into /admin/rewizje, as its "Zmiany
 * powiązań" section.
 *
 * That page holds three lists, so the parameters this one took by bare names
 * are renamed on the way: `type` becomes `edgeType` and `page` becomes
 * `edgePage`. `itemsPerPage` is dropped - the section pages by a fixed 25, and
 * on the hub the name belongs to the review queue. See `admin/rewizje/kolejka`
 * for why this is a route redirect.
 */
definePageMeta({
  redirect: (to) => {
    const query: Record<string, string> = {};
    if (typeof to.query.type === "string") query.edgeType = to.query.type;
    if (typeof to.query.page === "string") query.edgePage = to.query.page;
    return { path: "/admin/rewizje", query, hash: "#powiazania" };
  },
});
</script>

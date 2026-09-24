<template>
  <div />
</template>

<script setup lang="ts">
/** The review queue moved into /admin/rewizje, as its first section.
 *
 * Kept as a page rather than deleted: without it `kolejka` would be read as an
 * entry id by the `[id]` page next to it. The query goes along whole - the hub
 * reads `status`, `automatic`, `author`, `rewizja`, `page` and `itemsPerPage`
 * under the same names - so a permalink pasted in chat, a link out of
 * "Najaktywniejsi" or an old bookmark still opens the same proposals. A route
 * redirect rather than `navigateTo` in setup: the router follows it before this
 * component is ever loaded, on the first load and on a click alike (/admin is
 * rendered on the client only, so there is no server response to redirect).
 */
definePageMeta({
  redirect: (to) => ({
    path: "/admin/rewizje",
    query: to.query,
    hash: "#kolejka",
  }),
});
</script>

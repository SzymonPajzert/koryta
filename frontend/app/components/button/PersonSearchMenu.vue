<template>
  <v-menu location="bottom end" :disabled="targets.length === 0">
    <template #activator="{ props: menuProps }">
      <ButtonIconAction
        v-bind="menuProps"
        :icon="mdiOpenInNew"
        label="Eksploruj"
        tooltip="Wyszukiwarki i rejestry dla tej osoby."
        :data-testid="dataTestid"
      />
    </template>

    <v-list density="compact" min-width="280" max-width="420">
      <!-- What the button used to do on its own, kept as one item at the top
           rather than as the whole button: opening eight tabs is still the
           fastest way to check somebody, and it is now a thing the reader
           chooses rather than a thing that happens to them. -->
      <v-list-item
        :prepend-icon="mdiOpenInNew"
        data-testid="person-search-all"
        @click="searchAll()"
      >
        <v-list-item-title class="font-weight-medium">
          Otwórz wszystkie ({{ targets.length }})
        </v-list-item-title>
        <!-- The pop-up warning belongs here now. On the button it greeted
             every reader who hovered over it, including the ones about to open
             a single tab, for which no blocker has ever fired. -->
        <v-list-item-subtitle class="text-wrap">
          {{ SEARCH_ALL_TOOLTIP }}
        </v-list-item-subtitle>
      </v-list-item>

      <v-divider />

      <v-list-item
        v-for="target in targets"
        :key="target.key"
        :prepend-icon="sourceIcons[target.source]"
        :href="target.url"
        target="_blank"
        rel="noopener"
        :data-testid="`person-search-${target.source}`"
      >
        <v-list-item-title class="text-wrap">
          {{ target.label }}
        </v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
/** „Eksploruj" as a menu: every register and query the button would have
 * opened, one per row, with opening all of them still on offer.
 *
 * Checking somebody is usually one lookup - the register, or the query with the
 * town in it - and the button answered that by opening eight tabs and leaving
 * the reader to close seven. The rows are `href` links rather than click
 * handlers so that the browser's own „open in a new window", middle click and
 * „copy link" all work on them; only „otwórz wszystkie" needs `window.open`.
 */
import { mdiDomain, mdiGoogle, mdiOpenInNew, mdiWikipedia } from "@mdi/js";
import { toRef } from "vue";
import type { PersonRich } from "~~/shared/model";
import {
  SEARCH_ALL_TOOLTIP,
  usePersonSearch,
  type PersonSearchTarget,
} from "~/composables/usePersonSearch";

const props = withDefaults(
  defineProps<{
    person: PersonRich | undefined;
    /** Places to search in besides the ones the node carries - a page derives
     * them from its edges, which is the only place they exist. */
    extraLocations?: string[];
    /** Kept settable so the page that had the old button keeps its locator. */
    dataTestid?: string;
  }>(),
  { extraLocations: undefined, dataTestid: undefined },
);

const sourceIcons: Record<PersonSearchTarget["source"], string> = {
  rejestr: mdiDomain,
  wikipedia: mdiWikipedia,
  google: mdiGoogle,
};

const { searchTargets: targets, searchAll } = usePersonSearch(
  toRef(props, "person"),
  undefined,
  undefined,
  toRef(props, "extraLocations"),
);
</script>

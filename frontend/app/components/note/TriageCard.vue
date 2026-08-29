<template>
  <!-- The site's card rather than Vuetify's outlined one, which is the same
       decision the public note card made: one `k-card` rule in `app.vue` draws
       every card on the site, and the reviewer's queue showing a note in a
       different frame than the page it came from is how the two drifted apart
       in the first place. `v-card-text` and `v-divider` do not need a `v-card`
       around them - they are a padded div and a rule. -->
  <article class="k-card triage-card">
    <v-card-text class="pb-2">
      <!-- Which node the entry hangs off, and who wrote it: everything the
           reviewer needs to place the note before reading it. -->
      <div class="d-flex align-center ga-1 mb-1">
        <v-icon
          :icon="row.nodeType ? entityIcon(row.nodeType) : mdiHelp"
          size="small"
          class="text-medium-emphasis flex-shrink-0"
        />
        <component
          :is="entityUrl ? 'NuxtLink' : 'span'"
          :to="entityUrl"
          :target="entityUrl ? '_blank' : undefined"
          class="text-subtitle-2 font-weight-medium node-name"
          :class="entityUrl ? 'text-primary' : undefined"
        >
          {{ row.nodeName ?? row.nodeId }}
        </component>
        <v-icon v-if="entityUrl" :icon="mdiOpenInNew" size="x-small" />
      </div>

      <div class="d-flex align-center flex-wrap ga-2">
        <v-chip :color="kindConfig.color" variant="tonal" size="x-small">
          <v-icon start :icon="kindConfig.icon" />
          {{ kindConfig.title }}
        </v-chip>
        <UserChip :uid="row.userUid" />
        <span class="text-caption text-medium-emphasis">
          {{ formattedDate }}
        </span>
      </div>
    </v-card-text>

    <v-divider />

    <v-card-text class="py-3">
      <p class="note-text text-body-1">{{ row.note }}</p>
    </v-card-text>

    <!-- The url is half of what the type is read off, so on a phone it gets a
         row of its own rather than an icon somewhere in the text. -->
    <template v-if="row.url">
      <v-divider />
      <a
        :href="row.url"
        target="_blank"
        rel="noopener noreferrer"
        class="source-link d-flex align-center ga-2 px-4 py-3 text-primary"
      >
        <v-icon :icon="mdiLink" size="small" class="flex-shrink-0" />
        <span class="d-flex flex-column overflow-hidden">
          <span class="text-body-2 font-weight-medium">{{ sourceLabel }}</span>
          <span class="text-caption text-medium-emphasis text-truncate">
            {{ row.url }}
          </span>
        </span>
        <v-spacer />
        <v-icon :icon="mdiOpenInNew" size="small" class="flex-shrink-0" />
      </a>
    </template>
    <template v-else>
      <v-divider />
      <div class="px-4 py-2 text-caption text-medium-emphasis">
        Brak źródła - oceń po samej treści.
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiHelp, mdiLink, mdiOpenInNew } from "@mdi/js";
import { noteKindConfig } from "~/composables/notes";
import { generateEntityUrl } from "~/composables/slugs";
import type { NoteRow } from "~~/shared/model";
import { entityIcon } from "~/utils/entityIcon";
import { sourceDomain } from "~/utils/sourceDomain";

const { row } = defineProps<{ row: NoteRow }>();

const kindConfig = computed(() => noteKindConfig[row.kind]);

// A note written on a node nobody has approved yet has no name and so no url
// to build - the reviewer still gets the entry, just without the link.
const entityUrl = computed(() =>
  row.nodeName && row.nodeType
    ? generateEntityUrl(row.nodeType, row.nodeId, row.nodeName)
    : undefined,
);

// Readers paste all sorts of things into the url field. What is not an address
// at all gets a neutral heading here, because the line under it prints the raw
// value in full and a queue row that said "gazeta, strona 3" twice would read
// as a bug. `sourceDomain` is shared with the public note card, which makes the
// opposite call on that same case for the same reason - there it is the only
// place the value appears.
const sourceLabel = computed(() =>
  row.url ? (sourceDomain(row.url) ?? "Źródło") : "",
);

const formattedDate = computed(() =>
  row.createdAt
    ? new Date(row.createdAt).toLocaleDateString("pl-PL")
    : "bez daty",
);
</script>

<style scoped>
.node-name {
  overflow-wrap: anywhere;
}

.note-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}

.source-link {
  text-decoration: none;
}

.source-link:hover {
  background-color: rgba(var(--v-theme-primary), 0.06);
}
</style>

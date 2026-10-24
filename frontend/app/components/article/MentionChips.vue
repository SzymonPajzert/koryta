<template>
  <div class="d-flex align-center flex-wrap ga-2">
    <v-chip
      v-for="mention in mentions"
      :key="mention.edgeId"
      :to="mentionUrl(mention)"
      :variant="mention.published ? 'tonal' : 'outlined'"
      :prepend-icon="
        mention.nodeType ? entityIcon(mention.nodeType) : undefined
      "
      size="small"
      data-testid="article-mention-chip"
    >
      {{ mention.name ?? mention.nodeId }}
      <v-tooltip v-if="!mention.published" activator="parent" location="top">
        Oczekuje na zatwierdzenie — widoczne tylko dla zalogowanych.
      </v-tooltip>
      <template v-if="canEdit" #append>
        <v-icon
          :icon="mdiCloseCircle"
          size="small"
          class="ml-1"
          data-testid="article-mention-remove"
          @click.prevent.stop="emit('remove', mention)"
        />
      </template>
    </v-chip>

    <span
      v-if="mentions.length === 0 && !canEdit"
      class="text-caption text-medium-emphasis"
    >
      Nie zapisaliśmy jeszcze, kogo ten artykuł wymienia.
    </span>

    <div
      v-if="canEdit"
      class="d-flex align-center ga-2"
      style="min-width: 260px"
    >
      <FormEntityPicker
        v-model="picked"
        :entity="MENTIONABLE"
        label="Dodaj wspomnianą osobę"
        density="compact"
        hide-details
        variant="outlined"
        data-testid="article-mention-picker"
      />
      <v-btn
        color="primary"
        variant="tonal"
        size="small"
        :loading="saving"
        :disabled="!picked"
        data-testid="article-mention-add"
        @click="add()"
      >
        Dodaj
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
/** Who an article names, and the way to say it names somebody else too.
 *
 * Until this existed the only way to record a mention from the app was the
 * generic edge editor, which is not on the article's page and asks for both
 * ends of the relation - so in practice every mention came from the extraction
 * pipeline, and a name the model missed stayed missed. Whoever is reading the
 * article is the one who can see it.
 *
 * A mention nobody has approved yet is drawn outlined rather than hidden, the
 * same as a tag: it is an edge written with `published: false`, so a signed in
 * reader sees it and the public does not.
 */
import { ref } from "vue";
import { mdiCloseCircle } from "@mdi/js";
import { entityIcon } from "~/utils/entityIcon";
import type { Link, NodeType } from "~~/shared/model";
import { generateEntityUrl } from "~~/shared/slugs";
import type { ArticleRelation } from "~~/server/api/articles/[id]/relations.get";

/** What a `mentions` edge may point at. The section has always been "osoby i
 * instytucje", and the extraction pipeline records both. */
const MENTIONABLE: NodeType[] = ["person", "place"];

const props = defineProps<{
  mentions: ArticleRelation[];
  canEdit: boolean;
  saving?: boolean;
}>();

const emit = defineEmits<{
  add: [mention: Link<NodeType>];
  remove: [mention: ArticleRelation];
}>();

const picked = ref<Link<NodeType> | undefined>(undefined);

function mentionUrl(mention: ArticleRelation) {
  return mention.nodeType && mention.name
    ? generateEntityUrl(mention.nodeType, mention.nodeId, mention.name)
    : undefined;
}

function add() {
  if (!picked.value || props.saving) return;
  emit("add", picked.value);
  picked.value = undefined;
}
</script>

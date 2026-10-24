<template>
  <div class="d-flex align-center flex-wrap ga-2">
    <v-chip
      v-for="topic in topics"
      :key="topic.edgeId"
      :to="topicUrl(topic)"
      :variant="topic.published ? 'tonal' : 'outlined'"
      :prepend-icon="mdiTagOutline"
      size="small"
      color="primary"
      data-testid="article-topic-chip"
    >
      {{ topic.name ?? "temat bez nazwy" }}
      <v-tooltip v-if="!topic.published" activator="parent" location="top">
        Oczekuje na zatwierdzenie — widoczne tylko dla zalogowanych.
      </v-tooltip>
      <!-- One `#append`, because vuetify has one such slot per chip and two
           templates for it silently drop everything but the last. -->
      <template v-if="canEdit || canApprove" #append>
        <!-- A tag never reaches /admin/krawedzie while the topic it points at
             is still a draft: no edge may be published with an end nobody can
             open. So the decision is offered here, where whoever can make it is
             already looking at the tag. -->
        <v-icon
          v-if="canApprove && !topic.published"
          :icon="mdiCheckCircle"
          size="small"
          class="ml-1"
          data-testid="article-topic-approve"
          @click.prevent.stop="emit('approve', topic)"
        >
          <v-tooltip activator="parent" location="top">
            Zatwierdź temat i to przypisanie
          </v-tooltip>
        </v-icon>
        <v-icon
          v-if="canEdit"
          :icon="mdiCloseCircle"
          size="small"
          class="ml-1"
          data-testid="article-topic-remove"
          @click.prevent.stop="emit('remove', topic)"
        />
      </template>
    </v-chip>

    <span
      v-if="topics.length === 0 && !canEdit"
      class="text-caption text-medium-emphasis"
    >
      Ten artykuł nie należy jeszcze do żadnego tematu.
    </span>

    <div
      v-if="canEdit"
      class="d-flex align-center ga-2"
      style="min-width: 260px"
    >
      <FormEntityPicker
        v-model="picked"
        entity="topic"
        label="Dodaj do tematu"
        density="compact"
        hide-details
        variant="outlined"
        data-testid="article-topic-picker"
      />
      <v-btn
        color="primary"
        variant="tonal"
        size="small"
        :loading="saving"
        :disabled="!picked"
        data-testid="article-topic-add"
        @click="add()"
      >
        Dodaj
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
/** The stories an article belongs to, and the way to put it in another.
 *
 * A tag that nobody has approved yet is drawn outlined rather than hidden: it
 * is a `tagged` edge written with `published: false`, so a signed in reader
 * sees it and the public does not, and saying which is which is the whole
 * difference between "not tagged" and "tagged, waiting".
 */
import { ref } from "vue";
import { mdiCheckCircle, mdiCloseCircle, mdiTagOutline } from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import { generateEntityUrl } from "~~/shared/slugs";
import type { ArticleRelation } from "~~/server/api/articles/[id]/relations.get";

const props = defineProps<{
  topics: ArticleRelation[];
  canEdit: boolean;
  /** Whether this reader may put a tag live, which only an admin may. */
  canApprove?: boolean;
  saving?: boolean;
}>();

const emit = defineEmits<{
  add: [topic: Link<NodeType>];
  remove: [topic: ArticleRelation];
  approve: [topic: ArticleRelation];
}>();

const picked = ref<Link<NodeType> | undefined>(undefined);

function topicUrl(topic: ArticleRelation) {
  return topic.name
    ? generateEntityUrl("topic", topic.nodeId, topic.name)
    : undefined;
}

function add() {
  if (!picked.value || props.saving) return;
  emit("add", picked.value);
  picked.value = undefined;
}
</script>

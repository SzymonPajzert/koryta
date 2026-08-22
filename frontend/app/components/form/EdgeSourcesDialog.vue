<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card data-testid="edge-sources-dialog">
      <v-card-title class="pb-1">Źródła powiązania</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        {{ edgeLabel }}
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <v-skeleton-loader
          v-if="loading && !loaded"
          type="list-item-two-line"
        />

        <v-list v-else-if="sources.length" density="compact" class="py-0">
          <v-list-item
            v-for="source in sources"
            :key="source.id"
            :to="articleUrl(source)"
            :prepend-icon="mdiFileDocumentOutline"
            :data-testid="`edge-sources-item-${source.id}`"
          >
            <v-list-item-title class="text-wrap">
              {{ source.name ?? source.id }}
              <v-chip v-if="!source.published" size="x-small" variant="tonal">
                szkic
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle v-if="source.sourceURL">
              {{ source.sourceURL }}
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                v-if="canEdit"
                variant="text"
                size="small"
                color="error"
                :icon="mdiLinkVariantOff"
                :loading="detaching === source.id"
                :data-testid="`edge-sources-detach-${source.id}`"
                @click.stop.prevent="detach(source)"
              />
            </template>
          </v-list-item>
        </v-list>

        <v-alert
          v-else
          type="info"
          variant="tonal"
          density="compact"
          data-testid="edge-sources-empty"
        >
          To powiązanie nie powołuje się jeszcze na żaden artykuł.
        </v-alert>

        <template v-if="canEdit">
          <v-divider class="my-4" />
          <FormEntityPicker
            v-model="picked"
            entity="article"
            label="Dodaj źródło (artykuł)"
            density="comfortable"
            hide-details="auto"
            data-testid="edge-sources-picker"
          />
        </template>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="edge-sources-error"
        >
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          Zamknij
        </v-btn>
        <v-btn
          v-if="canEdit"
          color="success"
          variant="tonal"
          :loading="saving"
          :disabled="!picked"
          data-testid="edge-sources-add"
          @click="attach()"
        >
          Dodaj źródło
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** The articles one relation rests on, and adding another.
 *
 * Opened from wherever a relation is listed, which is why it takes an id and a
 * caption rather than an edge: the entity pages, the article page and the admin
 * queues each hold a different shape of the same edge, and none of them carries
 * the names of the articles it cites.
 *
 * Reading and writing both go through /api/edges/[id]/references, so what is on
 * screen after a change is what Firestore has - not a list patched in the
 * browser, which would disagree with whatever somebody else cited in the
 * meantime.
 */
import { computed, ref, watch } from "vue";
import { mdiFileDocumentOutline, mdiLinkVariantOff } from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import type {
  EdgeSource,
  EdgeSources,
} from "~~/server/api/edges/[id]/references.get";
import { authRequest, useAuthState } from "~/composables/auth";
import { generateEntityUrl } from "~/composables/slugs";

const props = defineProps<{
  modelValue: boolean;
  /** The relation whose sources these are. */
  edgeId: string;
  /** How the relation reads on the page it was opened from, so the dialog says
   * which claim is being cited without rebuilding the sentence itself. */
  edgeLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** A source was attached or detached; the page's own list is now stale. */
  changed: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const { user } = useAuthState();
/** Anybody may read what a claim rests on; only a signed in reader may change
 * it, and /api/edges/[id]/references refuses the write either way. */
const canEdit = computed(() => !!user.value);

const sources = ref<EdgeSource[]>([]);
const picked = ref<Link<NodeType> | undefined>(undefined);
const loading = ref(false);
const loaded = ref(false);
const saving = ref(false);
const detaching = ref<string | null>(null);
const error = ref<string | null>(null);

function articleUrl(source: EdgeSource) {
  return source.name
    ? generateEntityUrl("article", source.id, source.name)
    : undefined;
}

function describe(e: unknown, fallback: string) {
  const data = (e as { data?: { message?: string } } | null)?.data;
  return data?.message || (e instanceof Error ? e.message : "") || fallback;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const response = await authRequest<EdgeSources>(
      `/api/edges/${props.edgeId}/references`,
      { method: "GET", query: { latest: canEdit.value } },
    );
    sources.value = response.sources;
    loaded.value = true;
  } catch (e: unknown) {
    error.value = describe(e, "Nie udało się wczytać źródeł.");
  } finally {
    loading.value = false;
  }
}

async function change(body: { add?: string[]; remove?: string[] }) {
  error.value = null;
  try {
    await authRequest(`/api/edges/${props.edgeId}/references`, {
      method: "POST",
      body,
    });
    await load();
    emit("changed");
    return true;
  } catch (e: unknown) {
    error.value = describe(e, "Nie udało się zapisać źródła.");
    return false;
  }
}

async function attach() {
  if (!picked.value || saving.value) return;
  saving.value = true;
  try {
    if (await change({ add: [picked.value.id] })) picked.value = undefined;
  } finally {
    saving.value = false;
  }
}

async function detach(source: EdgeSource) {
  if (detaching.value) return;
  detaching.value = source.id;
  try {
    await change({ remove: [source.id] });
  } finally {
    detaching.value = null;
  }
}

// Opening is what loads, and the edge id is part of what it watches: a page
// keeps one dialog and swaps the relation into it, so mounting says nothing
// about which sources are wanted.
watch(
  () => [props.modelValue, props.edgeId] as const,
  ([isOpen]) => {
    if (!isOpen) return;
    sources.value = [];
    loaded.value = false;
    picked.value = undefined;
    load();
  },
  { immediate: true },
);
</script>

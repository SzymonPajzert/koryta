<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card data-testid="publish-node-dialog">
      <v-card-title>Opublikuj stronę</v-card-title>
      <v-card-text>
        <p class="mb-4 text-body-2">
          Strona <strong>{{ nodeName || nodeId }}</strong> stanie się widoczna
          publicznie. Możesz przy okazji opublikować jej powiązania.
        </p>

        <div v-if="pending" class="text-center py-6">
          <v-progress-circular indeterminate />
        </div>

        <v-alert
          v-else-if="loadError"
          type="warning"
          variant="tonal"
          class="mb-2"
          data-testid="publish-relations-error"
        >
          Nie udało się wczytać powiązań. Możesz opublikować samą stronę.
        </v-alert>

        <p
          v-else-if="candidates.length === 0"
          class="text-body-2 text-grey-darken-1"
          data-testid="publish-no-relations"
        >
          Ta strona nie ma powiązań czekających na publikację.
        </p>

        <template v-else>
          <div class="d-flex align-center mb-2">
            <div class="text-subtitle-2">
              Powiązania ({{ selected.length }}/{{ selectableIds.length }})
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              :disabled="selectableIds.length === 0"
              data-testid="publish-select-all"
              @click="toggleAll"
            >
              {{ allSelected ? "Odznacz wszystkie" : "Zaznacz wszystkie" }}
            </v-btn>
          </div>

          <v-list density="compact" class="py-0">
            <v-list-item
              v-for="relation in candidates"
              :key="relation.id"
              :class="{ 'text-disabled': !relation.publishable }"
              :data-testid="`publish-relation-${relation.id}`"
            >
              <template #prepend>
                <v-checkbox-btn
                  :model-value="selected.includes(relation.id)"
                  :disabled="!relation.publishable"
                  :data-testid="`publish-relation-check-${relation.id}`"
                  @update:model-value="toggle(relation.id)"
                />
              </template>
              <v-list-item-title>
                {{ relationLabel(relation) }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ relation.direction === "outgoing" ? "→" : "←" }}
                {{ relation.otherName || relation.otherId }}
                <span v-if="relation.hasPendingRevision">
                  · propozycja czeka na zatwierdzenie</span
                >
                <span v-else-if="relation.revisionToApprove">
                  · zostanie zatwierdzona najnowsza rewizja</span
                >
              </v-list-item-subtitle>
              <template #append>
                <v-icon
                  v-if="!relation.publishable"
                  :icon="mdiEyeOffOutline"
                  size="small"
                  color="grey"
                >
                  <v-tooltip activator="parent" location="left" max-width="280">
                    Druga strona ({{ relation.otherName || relation.otherId }})
                    nie jest opublikowana, więc tego powiązania nie można
                    pokazać publicznie.
                  </v-tooltip>
                </v-icon>
              </template>
            </v-list-item>
          </v-list>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          color="success"
          variant="tonal"
          :loading="saving"
          data-testid="publish-confirm"
          @click="confirm()"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiEyeOffOutline } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { relationsPlural } from "~/composables/edges";
import { edgeTypeLabels } from "~~/shared/edges";
import type {
  NodeRelation,
  NodeRelations,
} from "~~/server/api/edges/byNode.get";

const props = defineProps<{
  modelValue: boolean;
  nodeId: string;
  nodeName?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** The node went live, along with this many relations. */
  published: [payload: { relations: number }];
  failed: [error: unknown];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const relations = ref<NodeRelation[]>([]);
const selected = ref<string[]>([]);
const pending = ref(false);
const saving = ref(false);
const loadError = ref(false);

/** Only what a reviewer could still act on. An already published relation has
 * nothing to decide, and listing it would bury the ones that do. */
const candidates = computed(() =>
  relations.value.filter((relation) => !relation.published),
);

/** The ones that may actually go live. The rest are shown, greyed, so the
 * reviewer can see *why* a relation is not on offer rather than wondering
 * where it went. */
const selectableIds = computed(() =>
  candidates.value.filter((r) => r.publishable).map((r) => r.id),
);

const allSelected = computed(
  () =>
    selectableIds.value.length > 0 &&
    selected.value.length === selectableIds.value.length,
);

const confirmLabel = computed(() =>
  selected.value.length > 0
    ? `Opublikuj stronę i ${selected.value.length} ${relationsPlural(selected.value.length)}`
    : "Opublikuj tylko stronę",
);

function relationLabel(relation: NodeRelation): string {
  return relation.name || edgeTypeLabels[relation.type] || relation.type;
}

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...selectableIds.value];
}

async function load() {
  pending.value = true;
  loadError.value = false;
  selected.value = [];
  try {
    const data = await authRequest<NodeRelations>("/api/edges/byNode", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
    relations.value = data.relations;
  } catch (error) {
    // Not fatal: publishing the page on its own is still the thing the admin
    // came here to do, so the dialog degrades to that rather than closing.
    console.error("Failed to load relations", error);
    relations.value = [];
    loadError.value = true;
  } finally {
    pending.value = false;
  }
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) load();
  },
);

/** The node first, then its relations - publishing an edge is refused while
 * either of its pages is still a draft, and this node is one of them. */
async function confirm() {
  saving.value = true;
  try {
    await authRequest("/api/nodes/publish", {
      body: { node_id: props.nodeId, published: true },
    });
    if (selected.value.length > 0) {
      await authRequest("/api/edges/publish", {
        body: { edge_ids: selected.value, published: true },
      });
    }
    emit("published", { relations: selected.value.length });
    open.value = false;
  } catch (error) {
    emit("failed", error);
  } finally {
    saving.value = false;
  }
}
</script>

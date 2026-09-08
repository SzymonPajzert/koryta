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

        <v-alert
          v-if="relationsFailed"
          type="error"
          variant="tonal"
          class="mt-4"
          data-testid="publish-relations-failed"
        >
          <p class="mb-1">
            <strong>Strona została opublikowana, ale powiązania nie.</strong>
            Żadne z zaznaczonych powiązań nie trafiło na stronę - są publikowane
            razem albo wcale.
          </p>
          <p class="mb-1 text-body-2">{{ relationsFailed }}</p>
          <p class="mb-0 text-body-2">
            Spróbuj ponownie tutaj albo opublikuj je w
            <NuxtLink to="/admin/krawedzie">kolejce powiązań</NuxtLink> - strona
            jest już widoczna publicznie, więc ten dialog więcej się nie
            otworzy.
          </p>
        </v-alert>
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
import { edgeSideLabel, relationsPlural } from "~/composables/edges";
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
  /** `nodePublished` is the whole reason this carries a payload rather than the
   * error alone: the two calls are not one transaction, so a refusal on the
   * second leaves the page live with none of its relations. The page has to be
   * able to say that, and to reload the toggle it now disagrees with. */
  failed: [payload: { error: unknown; nodePublished: boolean }];
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
/** Set when the page went live but its relations were refused - the one
 * outcome the reviewer cannot see for themselves, because the dialog is still
 * open in front of the page it already changed. */
const relationsFailed = ref<string | null>(null);

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

/** What the row calls the relation, read from the page being published.
 *
 * A personal tie is named from both ends and the reviewer is standing at one of
 * them - see `Edge.reverse_name`. Everything else reads the same either way and
 * falls through to `name`. */
function relationLabel(relation: NodeRelation): string {
  return edgeSideLabel(
    {
      type: relation.type,
      name: relation.name ?? undefined,
      reverse_name: relation.reverse_name ?? undefined,
    },
    relation.direction,
  );
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
  relationsFailed.value = null;
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
  relationsFailed.value = null;
  let nodePublished = false;
  try {
    await authRequest("/api/nodes/publish", {
      body: { node_id: props.nodeId, published: true },
    });
    nodePublished = true;
    if (selected.value.length > 0) {
      // /api/edges/publish refuses the batch as a whole, so one relation whose
      // other end went back to being a draft between the dialog opening and
      // this click takes every other tick down with it - while the page above
      // is already live. Saying so is the difference between a reviewer who
      // retries and one who walks away believing the whole thing landed.
      await authRequest("/api/edges/publish", {
        body: { edge_ids: selected.value, published: true },
      });
    }
    emit("published", { relations: selected.value.length });
    open.value = false;
  } catch (error) {
    if (nodePublished && selected.value.length > 0) {
      relationsFailed.value = errorMessage(error);
    }
    emit("failed", { error, nodePublished });
  } finally {
    saving.value = false;
  }
}

/** The server's own words where it gave any - ofetch parks the parsed body on
 * `data`, and that is where the Polish explanation of a refusal lives. */
function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  return (
    data?.message ||
    (error instanceof Error ? error.message : "") ||
    "Nieznany błąd."
  );
}
</script>

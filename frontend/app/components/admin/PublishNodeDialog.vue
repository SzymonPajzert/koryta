<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card data-testid="publish-node-dialog">
      <v-card-title>Opublikuj stronę</v-card-title>
      <v-card-text>
        <p class="mb-4 text-body-2">
          Strona <strong>{{ nodeName || nodeId }}</strong> stanie się widoczna
          publicznie. Możesz przy okazji opublikować jej powiązania.
        </p>

        <v-alert
          v-if="autoApproveDate"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-testid="publish-auto-approve"
        >
          Ta strona nie ma zatwierdzonej rewizji, więc opublikujemy jej
          najnowszą wersję, z {{ autoApproveDate }}. Żeby pokazać inną,
          zatwierdź ją najpierw na
          <NuxtLink :to="`/admin/rewizje/${nodeId}`">liście rewizji</NuxtLink>.
        </v-alert>

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
import { edgeTypeLabels, relationsPlural } from "~/composables/edges";
import {
  latestPublishableRevision,
  normalizeUpdateTime,
} from "~~/shared/revisions";
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
  /** The node went live, along with this many relations - and, where it had no
   * approved revision, by way of approving the one named here. */
  published: [payload: { relations: number; approvedRevisionId?: string }];
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
/** When the page has nothing approved: the date of the version publishing will
 * approve on the reviewer's behalf. Worked out here rather than passed in, so
 * that every screen offering this dialog says it - the badge on a person's own
 * page has no revision list of its own to consult. */
const autoApproveDate = ref<string | null>(null);
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

/** Stamped the way `/admin/rewizje/[id]` heads its columns, so a reviewer who
 * goes looking for the version named here can find the column it is. */
function revisionDate(updateTime: unknown): string {
  const iso = normalizeUpdateTime(updateTime);
  if (!iso) return "nieznanej daty";
  return new Date(iso).toLocaleString("pl-PL");
}

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
  relationsFailed.value = null;
  selected.value = [];
  autoApproveDate.value = null;
  // Not fatal either, and separately awaited for that reason: which version is
  // about to go live is worth saying, but not worth refusing to publish over.
  void loadAutoApprove();
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

/** The same choice `/api/nodes/publish` will make, read from the same place
 * `/admin/rewizje/[id]` reads its table from. */
async function loadAutoApprove() {
  try {
    const data = await authRequest<{
      revisions: (Record<string, unknown> & { id: string })[];
      approvedRevisionId: string | null;
    }>("/api/revisions/byNode", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
    if (data.approvedRevisionId) return;
    const revision = latestPublishableRevision(data.revisions);
    if (!revision) return;
    autoApproveDate.value = revisionDate(revision.update_time);
  } catch (error) {
    // The publication itself will still say what it did, so a failure here
    // costs a sentence rather than the action.
    console.error("Failed to read revisions", error);
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
  let approvedRevisionId: string | undefined;
  try {
    const result = await authRequest<{ approvedRevisionId?: string | null }>(
      "/api/nodes/publish",
      { body: { node_id: props.nodeId, published: true } },
    );
    nodePublished = true;
    approvedRevisionId = result.approvedRevisionId ?? undefined;
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
    emit("published", {
      relations: selected.value.length,
      approvedRevisionId,
    });
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

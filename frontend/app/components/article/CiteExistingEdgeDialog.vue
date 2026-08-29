<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card data-testid="cite-existing-edge-dialog">
      <v-card-title class="pb-1">Istniejące powiązanie</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        Źródłem będzie: <strong>{{ articleName }}</strong>
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <FormEntityPicker
          v-model="entity"
          :entity="endpointTypes"
          label="Czyje powiązanie?"
          density="comfortable"
          hide-details="auto"
          autofocus
          data-testid="cite-existing-entity"
        />

        <template v-if="entity">
          <v-skeleton-loader v-if="loading" type="list-item-two-line" />

          <template v-else-if="candidates.length">
            <v-text-field
              v-if="candidates.length > 5"
              v-model="filter"
              label="Szukaj wśród powiązań"
              density="compact"
              hide-details
              clearable
              class="mt-4"
              data-testid="cite-existing-filter"
            />

            <v-list
              density="compact"
              class="mt-2"
              style="max-height: 320px; overflow-y: auto"
              data-testid="cite-existing-list"
            >
              <v-list-item
                v-for="candidate in shown"
                :key="candidate.id"
                :active="selected === candidate.id"
                :disabled="candidate.alreadyCited"
                :data-testid="`cite-existing-edge-${candidate.id}`"
                @click="selected = candidate.id"
              >
                <template #prepend>
                  <v-icon
                    :icon="
                      candidate.alreadyCited
                        ? mdiCheckCircleOutline
                        : selected === candidate.id
                          ? mdiRadioboxMarked
                          : mdiRadioboxBlank
                    "
                  />
                </template>
                <v-list-item-title class="text-wrap">
                  {{ candidate.title }}
                </v-list-item-title>
                <v-list-item-subtitle class="text-wrap">
                  {{ candidate.subtitle }}
                  <span v-if="candidate.alreadyCited">
                    · już powołuje się na ten artykuł
                  </span>
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </template>

          <v-alert
            v-else
            type="info"
            variant="tonal"
            density="compact"
            class="mt-4"
            data-testid="cite-existing-none"
          >
            Ta strona nie ma jeszcze żadnych powiązań. Dodaj je przyciskiem
            „Dodaj powiązanie”.
          </v-alert>
        </template>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="cite-existing-error"
        >
          {{ error }}
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
          :disabled="!selected"
          data-testid="cite-existing-submit"
          @click="submit()"
        >
          Dodaj źródło
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Cites the article the page is on for a relation that already exists.
 *
 * The other half of `AddSourcedEdgeDialog`: that one writes a new relation from
 * what the article says, and this one attaches the article to a claim somebody
 * has already made - which until now could only be done from the relation's own
 * end, and only if you knew it was there.
 *
 * The relations are read from the local graph rather than from an endpoint of
 * their own: it already returns every edge touching a node together with the
 * names of both ends, which is exactly what the list needs, and it is the same
 * data the entity page draws.
 */
import { computed, ref, watch } from "vue";
import {
  mdiCheckCircleOutline,
  mdiRadioboxBlank,
  mdiRadioboxMarked,
} from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import type { GraphLayout } from "~~/shared/graph/util";
import { edgeTypeLabels } from "~~/shared/edges";
import { authRequest } from "~/composables/auth";

const props = defineProps<{
  modelValue: boolean;
  articleId: string;
  articleName: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  added: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** Whose relations can be cited. The same three kinds `AddSourcedEdgeDialog`
 * joins, and the only ones the local graph draws at all. */
const endpointTypes: NodeType[] = ["person", "place", "region"];

type Candidate = {
  id: string;
  title: string;
  subtitle: string;
  alreadyCited: boolean;
};

const entity = ref<Link<NodeType> | undefined>(undefined);
const graph = ref<GraphLayout | undefined>(undefined);
const filter = ref("");
/** The relation about to be cited. Selection is kept here rather than left to
 * `v-list`'s own: the rows that are already cited are disabled, and a list that
 * owns the selection would still let a keyboard reach them. */
const selected = ref<string | undefined>(undefined);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const candidates = computed<Candidate[]>(() => {
  const id = entity.value?.id;
  const layout = graph.value;
  if (!id || !layout) return [];

  return layout.edges
    .filter((edge) => !!edge.id && (edge.source === id || edge.target === id))
    .map((edge): Candidate => {
      const sourceName = layout.nodes[edge.source]?.name ?? edge.source;
      const targetName = layout.nodes[edge.target]?.name ?? edge.target;
      const period = [edge.start_date, edge.end_date]
        .filter(Boolean)
        .join(" - ");
      return {
        id: edge.id!,
        title: `${sourceName} → ${targetName}`,
        subtitle: [edge.name || edgeTypeLabels[edge.type] || edge.type, period]
          .filter(Boolean)
          .join(" · "),
        alreadyCited: (edge.references ?? []).includes(props.articleId),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "pl"));
});

const shown = computed(() => {
  const term = (filter.value || "").trim().toLowerCase();
  if (!term) return candidates.value;
  return candidates.value.filter((candidate) =>
    `${candidate.title} ${candidate.subtitle}`.toLowerCase().includes(term),
  );
});

async function loadRelations(id: string) {
  loading.value = true;
  error.value = null;
  try {
    graph.value = await authRequest<GraphLayout>(`/api/graph/local/${id}`, {
      method: "GET",
      // `latest`, or a relation added minutes ago - the usual reason somebody
      // is here - is missing from the list, and the six hour cache is skipped.
      query: { latest: true, distance: 1, center: id },
    });
  } catch (e: unknown) {
    graph.value = undefined;
    error.value = describe(e, "Nie udało się wczytać powiązań.");
  } finally {
    loading.value = false;
  }
}

function describe(e: unknown, fallback: string) {
  const data = (e as { data?: { message?: string } } | null)?.data;
  return data?.message || (e instanceof Error ? e.message : "") || fallback;
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  entity.value = undefined;
  graph.value = undefined;
  selected.value = undefined;
  filter.value = "";
  error.value = null;
});

watch(entity, (picked) => {
  selected.value = undefined;
  filter.value = "";
  graph.value = undefined;
  if (picked) loadRelations(picked.id);
});

async function submit() {
  const edgeId = selected.value;
  if (!edgeId || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await authRequest(`/api/edges/${edgeId}/references`, {
      method: "POST",
      body: { add: [props.articleId] },
    });
    emit("added");
    open.value = false;
  } catch (e: unknown) {
    error.value = describe(e, "Nie udało się zapisać źródła.");
  } finally {
    saving.value = false;
  }
}
</script>

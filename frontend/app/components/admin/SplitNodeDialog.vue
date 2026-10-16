<template>
  <v-dialog v-model="open" max-width="760" scrollable>
    <v-card data-testid="split-node-dialog">
      <v-card-title>Ta strona to dwie osoby</v-card-title>
      <v-card-text>
        <p class="mb-4 text-body-2">
          Nic w bazie nie mówi, które powiązanie należy do którego z dwóch
          imienników - wie to tylko człowiek, który je przeczyta. Dlatego można
          albo zostawić znak dla siebie na potem, albo rozdzielić powiązania
          ręcznie.
        </p>

        <v-radio-group v-model="mode" hide-details data-testid="split-mode">
          <v-radio value="mark" data-testid="split-mode-mark">
            <template #label>
              <span>
                <strong>Zaznacz do rozdzielenia</strong> - zostaje notatka na
                stronie, powiązania się nie ruszają
              </span>
            </template>
          </v-radio>
          <v-radio value="now" data-testid="split-mode-now">
            <template #label>
              <span>
                <strong>Rozdziel teraz</strong> - wskaż powiązania drugiej osoby
                i stronę, na którą mają przejść
              </span>
            </template>
          </v-radio>
        </v-radio-group>

        <v-textarea
          v-model="reason"
          label="Powód"
          :hint="
            mode === 'mark'
              ? 'Co każe sądzić, że to dwie osoby. Przeczyta to ktoś, kto weźmie się za rozdzielanie.'
              : 'Trafia do dziennika zmian.'
          "
          persistent-hint
          rows="2"
          auto-grow
          class="mt-4 mb-2"
          data-testid="split-reason"
        />

        <template v-if="mode === 'now'">
          <v-divider class="my-4" />

          <div class="d-flex align-center mb-1">
            <div class="text-subtitle-2">
              Powiązania drugiej osoby ({{ selected.length }}/{{
                relations.length
              }})
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              :disabled="relations.length === 0"
              data-testid="split-select-all"
              @click="toggleAll"
            >
              {{ allSelected ? "Odznacz wszystkie" : "Zaznacz wszystkie" }}
            </v-btn>
          </div>
          <!-- Said before the list rather than after it, because the list is
               long and the default is the half of this that is easy to get
               wrong: an unticked relation is not "undecided", it stays here. -->
          <p class="mb-2 text-caption text-grey-darken-1">
            Zaznacz tylko to, co należy do tej <em>drugiej</em> osoby. Czego nie
            zaznaczysz, zostaje na tej stronie.
          </p>

          <div v-if="pendingRelations" class="text-center py-6">
            <v-progress-circular indeterminate />
          </div>
          <v-alert
            v-else-if="loadError"
            type="warning"
            variant="tonal"
            class="mb-2"
            data-testid="split-relations-error"
          >
            Nie udało się wczytać powiązań. Bez nich można tylko zaznaczyć
            stronę do rozdzielenia.
          </v-alert>
          <p
            v-else-if="relations.length === 0"
            class="text-body-2 text-grey-darken-1"
            data-testid="split-no-relations"
          >
            Ta strona nie ma powiązań, więc nie ma czego przenosić.
          </p>
          <v-list v-else density="compact" class="py-0">
            <v-list-item
              v-for="relation in relations"
              :key="relation.id"
              :data-testid="`split-relation-${relation.id}`"
            >
              <template #prepend>
                <v-checkbox-btn
                  :model-value="selected.includes(relation.id)"
                  :data-testid="`split-relation-check-${relation.id}`"
                  @update:model-value="toggle(relation.id)"
                />
              </template>
              <v-list-item-title>
                {{ relationLabel(relation) }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ relation.direction === "outgoing" ? "→" : "←" }}
                {{ relation.otherName || relation.otherId }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <v-divider class="my-4" />

          <v-radio-group
            v-model="destination"
            hide-details
            data-testid="split-destination"
          >
            <v-radio
              label="Przenieś na istniejącą stronę"
              value="existing"
              data-testid="split-destination-existing"
            />
            <v-radio
              label="Załóż nową stronę osoby"
              value="new"
              data-testid="split-destination-new"
            />
          </v-radio-group>

          <FormEntityPicker
            v-if="destination === 'existing'"
            v-model="into"
            entity="person"
            label="Strona, na którą przenieść"
            hint="Ta druga osoba, jeśli ma już swoją stronę."
            persistent-hint
            class="mt-4"
            data-testid="split-into-picker"
          />
          <v-text-field
            v-else
            v-model="intoName"
            label="Imię i nazwisko drugiej osoby"
            hint="Powstanie strona-szkic: zatwierdzona, ale jeszcze niewidoczna publicznie."
            persistent-hint
            class="mt-4"
            data-testid="split-into-name"
          />

          <v-btn
            variant="tonal"
            :disabled="!canPlan"
            :loading="pending"
            class="mt-4"
            data-testid="split-dry-run"
            @click="dryRun()"
          >
            Sprawdź, co się stanie
          </v-btn>

          <v-alert
            v-if="plan"
            type="info"
            variant="tonal"
            class="mt-4"
            data-testid="split-plan"
          >
            <p class="mb-1">
              <strong>{{ movingCount }}</strong>
              {{ relationsPlural(movingCount) }} przejdzie na
              {{
                plan.created_into
                  ? `nową stronę „${intoName.trim()}”`
                  : `stronę „${into?.name || plan.into_id}”`
              }}.
            </p>
            <p class="mb-1">
              <strong>{{ stayingCount }}</strong>
              {{ relationsPlural(stayingCount) }} zostaje tutaj.
            </p>
            <p v-if="plan.counts.review" class="mb-1">
              W tym <strong>{{ plan.counts.review }}</strong> mimo tego, że
              strona docelowa mówi już to samo - takie powtórzenie trzeba
              obejrzeć samemu.
            </p>
            <p v-if="plan.counts.collapsed" class="mb-1">
              <strong>{{ plan.counts.collapsed }}</strong>
              {{ relationsPlural(plan.counts.collapsed) }} zostaje tutaj, bo
              strona docelowa mówi już dokładnie to samo. Rozdzielanie niczego
              nie usuwa.
            </p>
            <p v-if="plan.counts.self" class="mb-0">
              <strong>{{ plan.counts.self }}</strong>
              {{ relationsPlural(plan.counts.self) }} zostaje tutaj: po
              przeniesieniu prowadziłoby ze strony do niej samej.
            </p>
          </v-alert>
        </template>

        <v-alert
          v-if="done"
          type="success"
          variant="tonal"
          class="mt-4"
          data-testid="split-done"
        >
          <p class="mb-0">{{ done }}</p>
          <p v-if="createdUrl" class="mb-0 mt-1">
            <NuxtLink :to="createdUrl">Otwórz nową stronę</NuxtLink>
          </p>
        </v-alert>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-4"
          data-testid="split-error"
        >
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="open = false">
          {{ done ? "Zamknij" : "Anuluj" }}
        </v-btn>
        <v-btn
          v-if="mode === 'mark'"
          color="warning"
          variant="tonal"
          :disabled="!canMark"
          :loading="saving"
          data-testid="split-mark-confirm"
          @click="markOnly()"
        >
          Zaznacz do rozdzielenia
        </v-btn>
        <v-btn
          v-else
          color="error"
          variant="tonal"
          :disabled="!plan || !!done"
          :loading="saving"
          data-testid="split-confirm"
          @click="confirm()"
        >
          Rozdziel
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { authRequest, useAuthState } from "~/composables/auth";
import { edgeTypeLabels, relationsPlural } from "~/composables/edges";
import { generateEntityUrl } from "~/composables/slugs";
import type { Link, NodeType, Person } from "~~/shared/model";
import type {
  NodeRelation,
  NodeRelations,
} from "~~/server/api/edges/byNode.get";
import type { NodeSplit } from "~~/server/api/nodes/split.post";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    nodeId: string;
    nodeName?: string | null;
  }>(),
  { nodeName: null },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** Something was written. `marked` separates the note from the real split,
   * because only the second one changes what the page below is drawing. */
  split: [payload: { marked: boolean; intoId?: string }];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const { user } = useAuthState();

const mode = ref<"mark" | "now">("mark");
const reason = ref("");
const relations = ref<NodeRelation[]>([]);
const selected = ref<string[]>([]);
const destination = ref<"existing" | "new">("existing");
const into = ref<Link<NodeType> | undefined>(undefined);
const intoName = ref("");
const plan = ref<NodeSplit | null>(null);
const pending = ref(false);
const pendingRelations = ref(false);
const saving = ref(false);
const loadError = ref(false);
const error = ref<string | null>(null);
const done = ref<string | null>(null);
const createdUrl = ref<string | null>(null);

/** The note this page will carry until somebody separates the two people.
 *
 * Written to shared state as well as to Firestore, because `AdminNeedsSplitBanner`
 * cannot see the write any other way: `/api/nodes/[id]` is cached for six hours
 * and `mark_only` does not clear that cache, and for a signed in reader the
 * page is answered from the latest revision, which carries the fields a
 * contributor edits rather than the ones an admin sets on the document. The key
 * is the contract between the two components - keep them in step.
 */
const localMark = useState<NonNullable<Person["needs_split"]> | null>(
  `needs-split-${props.nodeId}`,
  () => null,
);

const allSelected = computed(
  () =>
    relations.value.length > 0 &&
    selected.value.length === relations.value.length,
);

/** What actually leaves this page. `review` moves alongside `moved` - the
 * endpoint refuses to collapse anything, because removing a relation is the
 * merge's case and nobody has made it here. */
const movingCount = computed(
  () => (plan.value?.counts.moved ?? 0) + (plan.value?.counts.review ?? 0),
);

/** Everything else, ticked or not: a relation the destination already states is
 * left where it was found, and so is one that would have pointed at itself. */
const stayingCount = computed(() => relations.value.length - movingCount.value);

const canMark = computed(() => reason.value.trim().length > 0 && !done.value);

const canPlan = computed(() => {
  if (reason.value.trim().length === 0) return false;
  if (selected.value.length === 0) return false;
  return destination.value === "existing"
    ? !!into.value && into.value.id !== props.nodeId
    : intoName.value.trim().length > 0;
});

function relationLabel(relation: NodeRelation): string {
  return relation.name || edgeTypeLabels[relation.type] || relation.type;
}

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}

function toggleAll() {
  selected.value = allSelected.value
    ? []
    : relations.value.map((relation) => relation.id);
}

function reset() {
  mode.value = "mark";
  reason.value = "";
  selected.value = [];
  destination.value = "existing";
  into.value = undefined;
  intoName.value = "";
  plan.value = null;
  error.value = null;
  done.value = null;
  createdUrl.value = null;
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) reset();
  },
);

// The relations are only fetched for the branch that lists them: marking is the
// quick path, and it should not wait on a request it never reads.
watch(mode, (value) => {
  plan.value = null;
  if (value === "now" && relations.value.length === 0) loadRelations();
});

// Any change to what moves, or to where, invalidates the plan the confirm
// button would otherwise apply.
watch([selected, destination, into, intoName], () => {
  plan.value = null;
});

async function loadRelations() {
  pendingRelations.value = true;
  loadError.value = false;
  try {
    const data = await authRequest<NodeRelations>("/api/edges/byNode", {
      method: "GET",
      query: { nodeId: props.nodeId },
    });
    relations.value = data.relations;
  } catch (e) {
    console.error("Failed to load relations", e);
    relations.value = [];
    loadError.value = true;
  } finally {
    pendingRelations.value = false;
  }
}

function body(dryRun: boolean) {
  return {
    node_id: props.nodeId,
    reason: reason.value.trim(),
    edge_ids: selected.value,
    ...(destination.value === "existing"
      ? { into_id: into.value?.id }
      : { into_person: { name: intoName.value.trim() } }),
    dry_run: dryRun,
  };
}

async function markOnly() {
  saving.value = true;
  error.value = null;
  try {
    await authRequest<NodeSplit>("/api/nodes/split", {
      body: {
        node_id: props.nodeId,
        reason: reason.value.trim(),
        mark_only: true,
      },
    });
    localMark.value = {
      reason: reason.value.trim(),
      at: new Date().toISOString(),
      user: user.value?.uid ?? "",
    };
    emit("split", { marked: true });
    // Closed rather than left on a success message: the banner behind it says
    // the same thing, and it is the thing that will still be there tomorrow.
    open.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function dryRun() {
  pending.value = true;
  error.value = null;
  plan.value = null;
  try {
    plan.value = await authRequest<NodeSplit>("/api/nodes/split", {
      body: body(true),
    });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    pending.value = false;
  }
}

async function confirm() {
  if (!plan.value) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await authRequest<NodeSplit>("/api/nodes/split", {
      body: body(false),
    });
    // The split answers the mark, so the banner goes with it.
    localMark.value = null;
    emit("split", { marked: false, intoId: result.into_id });
    done.value = `Przeniesiono ${result.counts.moved} ${relationsPlural(result.counts.moved)}.`;
    createdUrl.value =
      result.created_into && result.into_id
        ? generateEntityUrl("person", result.into_id, intoName.value.trim())
        : null;
    // The dialog stays open on the link to the page that was just created -
    // it is a draft, so nothing else on the site links to it yet.
    await refreshNuxtData();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

/** The server's own words where it gave any - ofetch parks the parsed body on
 * `data`, and that is where the Polish explanation of a refusal lives. */
function errorMessage(e: unknown): string {
  const data = (e as { data?: { message?: string } } | null)?.data;
  return (
    data?.message || (e instanceof Error ? e.message : "") || "Nieznany błąd."
  );
}
</script>

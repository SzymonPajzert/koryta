<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card data-testid="merge-node-dialog">
      <v-card-title>Ta strona to duplikat</v-card-title>
      <v-card-text>
        <p class="mb-4 text-body-2">
          Jedna osoba pod dwoma zapisami nazwiska to dwie strony, każda z połową
          tego, co o niej wiadomo. Scalenie przenosi powiązania na tę stronę,
          która zostaje - a ta druga znika i zaczyna przekierowywać na nią, więc
          stare linki dalej działają.
        </p>

        <!-- Which page dies is the whole decision, and it is the one an admin
             can get backwards without noticing: both rows name both pages, so
             there is nothing to infer from the order they were picked in. -->
        <v-radio-group
          v-model="direction"
          class="mb-2"
          hide-details
          data-testid="merge-direction"
        >
          <v-radio value="this-is-duplicate" data-testid="merge-direction-this">
            <template #label>
              <span>
                <strong>Ta strona</strong> ({{ thisLabel }}) jest duplikatem i
                zniknie
              </span>
            </template>
          </v-radio>
          <v-radio
            value="other-is-duplicate"
            data-testid="merge-direction-other"
          >
            <template #label>
              <span>
                <strong>Wybrana niżej strona</strong> jest duplikatem i zniknie;
                zostaje ta ({{ thisLabel }})
              </span>
            </template>
          </v-radio>
        </v-radio-group>

        <FormEntityPicker
          v-model="other"
          :entity="nodeType"
          label="Druga strona"
          hint="Szukaj po nazwisku. To ta sama osoba, tylko zapisana inaczej."
          persistent-hint
          class="mb-4"
          data-testid="merge-other-picker"
        />

        <v-textarea
          v-model="reason"
          label="Powód scalenia"
          hint="Trafia do dziennika zmian i do opisu powiązań, które scalenie usunie."
          persistent-hint
          rows="2"
          auto-grow
          class="mb-2"
          data-testid="merge-reason"
        />

        <v-alert
          v-if="sameNode"
          type="warning"
          variant="tonal"
          class="mb-2"
          data-testid="merge-same-node"
        >
          To ta sama strona. Wybierz tę drugą.
        </v-alert>

        <v-btn
          variant="tonal"
          :disabled="!canPlan"
          :loading="pending"
          class="mb-4"
          data-testid="merge-dry-run"
          @click="dryRun()"
        >
          Sprawdź, co się stanie
        </v-btn>

        <template v-if="plan">
          <v-alert
            type="info"
            variant="tonal"
            class="mb-2"
            data-testid="merge-plan"
          >
            <p class="mb-1">
              <strong>{{ movingCount }}</strong>
              {{ relationsPlural(movingCount) }} przeniesie się na stronę, która
              zostaje.
            </p>
            <p v-if="plan.counts.collapsed" class="mb-1">
              <strong>{{ plan.counts.collapsed }}</strong>
              {{ relationsPlural(plan.counts.collapsed) }} zniknie - strona,
              która zostaje, mówi już dokładnie to samo.
            </p>
            <p v-if="plan.counts.review" class="mb-1">
              W tym <strong>{{ plan.counts.review }}</strong> trzeba potem
              obejrzeć: strona, która zostaje, mówi już to samo, a dwie
              identyczne kandydatury to wciąż dwie kandydatury, więc scalenie
              ich nie łączy.
              <span v-if="reviewByType.length" class="d-inline-block">
                <v-chip
                  v-for="entry in reviewByType"
                  :key="entry.type"
                  size="x-small"
                  class="ml-1"
                >
                  {{ edgeTypeLabels[entry.type] || entry.type }} ×
                  {{ entry.count }}
                </v-chip>
              </span>
            </p>
            <p v-if="plan.counts.self" class="mb-1">
              <strong>{{ plan.counts.self }}</strong>
              {{ relationsPlural(plan.counts.self) }} zniknie, bo po scaleniu
              prowadziłoby ze strony do niej samej.
            </p>
            <p v-if="nothingToMove" class="mb-0">
              Duplikat nie ma powiązań - zniknie sam.
            </p>
          </v-alert>

          <p class="mb-0 text-body-2" data-testid="merge-summary">
            Zostaje <strong>{{ survivorName }}</strong
            >. Strona <strong>{{ duplicateName }}</strong> zostanie oznaczona
            jako duplikat, zniknie z serwisu i będzie przekierowywać na tę
            pierwszą.
          </p>
        </template>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-4"
          data-testid="merge-error"
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
          color="error"
          variant="tonal"
          :disabled="!plan"
          :loading="saving"
          data-testid="merge-confirm"
          @click="confirm()"
        >
          Scal na stałe
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { authRequest } from "~/composables/auth";
import { edgeTypeLabels, relationsPlural } from "~/composables/edges";
import { generateEntityUrl } from "~/composables/slugs";
import type { Link, NodeType } from "~~/shared/model";
import type { NodesMerged } from "~~/server/api/nodes/merge.post";
import type { MergePlan } from "~~/server/utils/merge";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** The page the dialog was opened from. It is one of the two ends; which
     * one is the admin's choice, not this component's. */
    nodeId: string;
    nodeName?: string | null;
    /** Both ends have to be the same kind - the endpoint refuses a person and
     * a company - so this is also what the picker is limited to. */
    nodeType?: NodeType;
  }>(),
  { nodeName: null, nodeType: "person" },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** The merge went through. `survivorId` is the page that is left, which is
   * this one only when the admin merged the *other* page away - hence the
   * flag, so the host knows whether it is still looking at a live page. */
  merged: [payload: { survivorId: string; wasThisPage: boolean }];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** Which way round the merge goes. Named after the page the dialog sits on,
 * because that is the one the admin is looking at while they answer. */
const direction = ref<"this-is-duplicate" | "other-is-duplicate">(
  "this-is-duplicate",
);
const other = ref<Link<NodeType> | undefined>(undefined);
const reason = ref("");
const plan = ref<MergePlan | null>(null);
const pending = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const thisLabel = computed(() => props.nodeName || props.nodeId);

const duplicateId = computed(() =>
  direction.value === "this-is-duplicate" ? props.nodeId : other.value?.id,
);
const survivorId = computed(() =>
  direction.value === "this-is-duplicate" ? other.value?.id : props.nodeId,
);

/** The names the confirmation is written with. The server's own reading of
 * them where a plan came back - it followed the survivor's `merged_into` and
 * may have landed on a third page, and saying so is the point. */
const duplicateName = computed(
  () =>
    plan.value?.duplicate_name ||
    (direction.value === "this-is-duplicate"
      ? thisLabel.value
      : other.value?.name) ||
    duplicateId.value,
);
const survivorName = computed(
  () =>
    plan.value?.survivor_name ||
    (direction.value === "this-is-duplicate"
      ? other.value?.name
      : thisLabel.value) ||
    survivorId.value,
);

const sameNode = computed(
  () => !!other.value && other.value.id === props.nodeId,
);

const canPlan = computed(
  () => !!other.value && !sameNode.value && reason.value.trim().length > 0,
);

const nothingToMove = computed(
  () => !!plan.value && plan.value.edges.length === 0,
);

/** Everything that ends up on the survivor. `review` moves too - the endpoint
 * only ever collapses what `identicalMeansSame` vouches for - so counting it
 * apart from `moved` would understate the page an admin is about to be left
 * with. */
const movingCount = computed(
  () => (plan.value?.counts.moved ?? 0) + (plan.value?.counts.review ?? 0),
);

/** The relations the merge keeps but cannot vouch for, grouped by what they
 * say. A count alone does not tell an admin where to look afterwards; "election
 * × 12" does. */
const reviewByType = computed(() => {
  const counts = new Map<string, number>();
  for (const edge of plan.value?.edges ?? []) {
    if (edge.disposition !== "review") continue;
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
});

function reset() {
  direction.value = "this-is-duplicate";
  other.value = undefined;
  reason.value = "";
  plan.value = null;
  error.value = null;
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) reset();
  },
);

// A plan is an answer about one pair of pages in one direction. Changing either
// has to take the confirm button away with it, or the button would apply a
// merge the admin never read the consequences of.
watch([direction, other], () => {
  plan.value = null;
});

function body(dryRun: boolean) {
  return {
    duplicate_id: duplicateId.value,
    survivor_id: survivorId.value,
    reason: reason.value.trim(),
    dry_run: dryRun,
  };
}

/** Always first, and the only thing the primary button does until it has run:
 * how many relations disappear is the one fact worth knowing before agreeing to
 * a merge, and it cannot be worked out from the two pages by eye. */
async function dryRun() {
  pending.value = true;
  error.value = null;
  plan.value = null;
  try {
    const response = await authRequest<NodesMerged>("/api/nodes/merge", {
      body: body(true),
    });
    plan.value = response.plan;
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
    const response = await authRequest<NodesMerged>("/api/nodes/merge", {
      body: body(false),
    });
    const survivor = response.plan.survivor_id;
    const wasThisPage = response.plan.duplicate_id !== props.nodeId;
    emit("merged", { survivorId: survivor, wasThisPage });
    open.value = false;

    if (wasThisPage) {
      // This page survived and has just taken on the duplicate's relations, so
      // what is drawn under the dialog is already out of date.
      await refreshNuxtData();
      return;
    }
    // This page is the duplicate. It answers with the survivor now, so staying
    // would leave the admin on a page whose url no longer means what it says -
    // go to the survivor directly rather than through that redirect.
    const url = generateEntityUrl(
      props.nodeType,
      survivor,
      response.plan.survivor_name,
    );
    await navigateTo(url);
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

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card data-testid="add-relation-dialog">
      <v-card-title class="pb-1">{{ title }}</v-card-title>
      <v-card-subtitle class="pb-3">
        Dla: <strong>{{ nodeName }}</strong>
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <!-- Who first. The name is the thing somebody actually has in mind;
             which relation it is follows from the pair, below. -->
        <FormEntityPicker
          v-model="other"
          :entity="searchableTypes"
          :label="pickerLabel"
          density="comfortable"
          hide-details="auto"
          autofocus
          data-testid="add-relation-entity"
        />

        <template v-if="other">
          <!-- Named as a pair rather than a sentence. Polish would want the
               instrumental case here ("z Orlenem"), and there is no declining
               an arbitrary company name - so the two are shown either side of
               an arrow, which needs no case at all. -->
          <div class="d-flex align-center flex-wrap ga-2 mt-4 mb-2">
            <span class="text-caption text-medium-emphasis"
              >Rodzaj powiązania:</span
            >
            <span class="text-body-2">
              <strong>{{ nodeName }}</strong>
              <v-icon :icon="mdiArrowRight" size="small" class="mx-1" />
              <strong>{{ other.name }}</strong>
            </span>
          </div>
          <v-chip-group
            v-model="choiceIndex"
            selected-class="text-primary"
            mandatory
            column
            data-testid="add-relation-verbs"
          >
            <v-chip
              v-for="(choice, index) in choices"
              :key="choice.edgeTypeExt + '-' + choice.direction"
              :value="index"
              filter
              variant="tonal"
              :data-testid="`add-relation-verb-${choice.edgeTypeExt}-${choice.direction}`"
            >
              {{ choice.verb }}
            </v-chip>
          </v-chip-group>

          <v-alert
            v-if="choices.length === 0"
            type="info"
            variant="tonal"
            density="compact"
            class="mt-2"
            data-testid="add-relation-no-verbs"
          >
            Nie ma powiązania, które łączyłoby te dwie strony.
          </v-alert>

          <FormRelationDetailFields
            v-if="choice"
            v-model="details"
            :real-type="option?.realType"
            prefix="add-relation"
            class="mt-1"
          >
            <!-- A tagged edge says which story an article belongs to, which is
                 an editorial call rather than a claim needing a citation. -->
            <v-col
              v-if="nodeType !== 'article' && option?.realType !== 'tagged'"
              cols="12"
            >
              <FormEntityPicker
                v-model="reference"
                entity="article"
                label="Źródło (artykuł) — opcjonalnie"
                density="compact"
                hide-details
                data-testid="add-relation-reference"
              />
            </v-col>
          </FormRelationDetailFields>
        </template>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="add-relation-error"
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
          :disabled="!readyToSubmit"
          data-testid="add-relation-submit"
          @click="submit()"
        >
          Dodaj powiązanie
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiArrowRight } from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import {
  edgeTypeOptions,
  relationChoices,
  type edgeTypeExt,
} from "~/composables/useEdgeTypes";
import { authRequest } from "~/composables/auth";
import type { RelationDetails } from "~/components/form/RelationDetailFields.vue";
import { relationDateRule } from "~/utils/relationDate";

const props = defineProps<{
  modelValue: boolean;
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  /** What the section this was opened from is about. Everything the page can
   * be joined to, when left out. */
  types?: edgeTypeExt[];
  /** Heading, so a section can say what it is adding rather than "powiązanie". */
  title?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  added: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const other = ref<Link<NodeType> | undefined>(undefined);
const reference = ref<Link<NodeType> | undefined>(undefined);
const choiceIndex = ref<number | undefined>(undefined);
const saving = ref(false);
const error = ref<string | null>(null);
const details = ref<RelationDetails>(emptyDetails());

function emptyDetails(): RelationDetails {
  return { name: "", start_date: "", end_date: "", party: "", committee: "" };
}

const title = computed(() => props.title ?? "Dodaj powiązanie");

/** Which kinds the search offers: whatever the allowed relations could put at
 * the other end of this page. Asking for the relation first would have to list
 * every one of them up front, which is the step this drops. */
const searchableTypes = computed<NodeType[]>(() => {
  const kinds = new Set<NodeType>();
  // An article is normally a citation rather than one end of a relation - that
  // is the source picker's job, at the bottom of this dialog. `tagged` is the
  // exception: there an article really is one end, so a topic page has to be
  // able to search for one.
  let articleIsAnEnd = false;
  for (const option of Object.values(edgeTypeOptions)) {
    if (props.types && !props.types.includes(option.value)) continue;
    if (option.sourceType === props.nodeType) kinds.add(option.targetType);
    if (option.targetType === props.nodeType) kinds.add(option.sourceType);
    if (option.realType === "tagged" && option.targetType === props.nodeType) {
      articleIsAnEnd = true;
    }
  }
  if (!articleIsAnEnd) kinds.delete("article");
  return Array.from(kinds);
});

const pickerLabel = computed(() => {
  const labels: Partial<Record<NodeType, string>> = {
    person: "osobę",
    place: "firmę",
    region: "region",
    article: "artykuł",
    topic: "temat",
  };
  const named = searchableTypes.value
    .map((kind) => labels[kind])
    .filter((label): label is string => !!label);
  if (named.length === 0) return "Wyszukaj";
  // "osobę, firmę lub region" - a Polish list joins its last item with "lub",
  // not with another comma.
  const last = named[named.length - 1]!;
  const head = named.slice(0, -1);
  return head.length > 0
    ? `Wyszukaj ${head.join(", ")} lub ${last}`
    : `Wyszukaj ${last}`;
});

const choices = computed(() =>
  other.value
    ? relationChoices(props.nodeType, other.value.type, props.types)
    : [],
);

const choice = computed(() =>
  choiceIndex.value === undefined
    ? undefined
    : choices.value[choiceIndex.value],
);

const option = computed(() =>
  choice.value ? edgeTypeOptions[choice.value.edgeTypeExt] : undefined,
);

const readyToSubmit = computed(
  () =>
    !!other.value &&
    !!choice.value &&
    other.value.id !== props.nodeId &&
    relationDateRule(details.value.start_date) === true &&
    relationDateRule(details.value.end_date) === true,
);

/** A fresh dialog every time it opens: leaving the last relation in the fields
 * is how somebody adds the same job twice. */
watch(open, (isOpen) => {
  if (!isOpen) return;
  other.value = undefined;
  reference.value = undefined;
  choiceIndex.value = undefined;
  error.value = null;
  details.value = emptyDetails();
});

// Picking a different entity can change which verbs apply, and an index into
// the old list means something else in the new one.
watch(other, () => {
  choiceIndex.value = choices.value.length > 0 ? 0 : undefined;
});

async function submit() {
  if (!readyToSubmit.value || saving.value) return;
  const picked = choice.value!;
  const outgoing = picked.direction === "outgoing";

  saving.value = true;
  error.value = null;
  try {
    await authRequest<{ id: string }>("/api/edges/create", {
      method: "POST",
      body: {
        source: outgoing ? props.nodeId : other.value!.id,
        target: outgoing ? other.value!.id : props.nodeId,
        type: edgeTypeOptions[picked.edgeTypeExt].realType,
        name: details.value.name,
        start_date: details.value.start_date,
        end_date: details.value.end_date,
        party: details.value.party,
        committee: details.value.committee,
        references: reference.value ? [reference.value.id] : [],
      },
    });
    emit("added");
    open.value = false;
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    error.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zapisać powiązania.";
  } finally {
    saving.value = false;
  }
}
</script>

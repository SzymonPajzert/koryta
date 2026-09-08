<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card data-testid="promote-fact-dialog">
      <v-card-title class="pb-1">Utwórz powiązanie z tego faktu</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        Powiązanie trafi do poczekalni jako szkic - zobaczy je administrator,
        zanim stanie się publiczne.
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <!-- What the model actually said, verbatim. The reader is being asked
             to turn a sentence into a claim in the graph, so the sentence has
             to be in front of them while they do it. -->
        <blockquote v-if="fact.justification" class="quote text-body-2 mb-4">
          {{ fact.justification }}
        </blockquote>

        <div class="d-flex align-center flex-wrap ga-2 mb-3 text-body-2">
          <strong>{{ fact.personNodeName }}</strong>
          <v-icon :icon="mdiArrowRight" size="small" />
          <v-chip size="small" variant="tonal" color="primary">
            {{ verb || "powiązany/a z" }}
          </v-chip>
          <v-icon :icon="mdiArrowRight" size="small" />
          <span class="text-medium-emphasis">
            {{ rule.targetLabel.toLowerCase() }}
          </span>
        </div>

        <!-- The far end is picked, never guessed. The pipeline resolves only
             the person side of a fact; `organization` and `object` are the
             strings the article used, and two companies share a name as
             readily as two people do. -->
        <p class="text-caption text-medium-emphasis mb-1">
          Artykuł pisze o:
          <strong>{{ targetHint }}</strong>
        </p>
        <FormEntityPicker
          v-model="target"
          :entity="[rule.targetType]"
          :label="rule.targetLabel"
          density="comfortable"
          hide-details="auto"
          autofocus
          class="mb-3"
          data-testid="promote-fact-target"
        />

        <v-row dense>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="name"
              :label="nameLabel"
              density="compact"
              hide-details
              data-testid="promote-fact-name"
            />
          </v-col>
          <!-- A personal tie reads both ways and the site prints both, so the
               promotion asks for the second word as well - see
               `Edge.reverse_name`. The extracted fact only ever carries one of
               them: the model is told to describe the object from the
               subject's side. -->
          <v-col v-if="rule.edgeType === 'connection'" cols="12" md="6">
            <v-text-field
              v-model="reverseName"
              :label="reverseNameLabel"
              placeholder="np. mąż"
              density="compact"
              hide-details="auto"
              data-testid="promote-fact-reverse-name"
            />
          </v-col>
          <v-col
            v-if="reverseSuggestions.length > 0"
            cols="12"
            class="d-flex align-center flex-wrap ga-1"
          >
            <span class="text-caption text-medium-emphasis mr-1">
              Podpowiedzi:
            </span>
            <v-chip
              v-for="suggestion in reverseSuggestions"
              :key="suggestion"
              size="small"
              variant="tonal"
              :data-testid="`promote-fact-reverse-suggestion-${suggestion}`"
              @click="reverseName = suggestion"
            >
              {{ suggestion }}
            </v-chip>
          </v-col>
          <v-col v-if="rule.edgeType === 'employed'" cols="6" md="3">
            <v-text-field
              v-model="startDate"
              label="Od"
              placeholder="RRRR-MM-DD"
              density="compact"
              hide-details="auto"
              :rules="[dateRule]"
            />
          </v-col>
          <v-col v-if="rule.edgeType === 'employed'" cols="6" md="3">
            <v-text-field
              v-model="endDate"
              label="Do"
              placeholder="RRRR-MM-DD"
              density="compact"
              hide-details="auto"
              :rules="[dateRule]"
            />
          </v-col>
        </v-row>

        <v-alert
          v-if="fact.articleNodeId"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          Źródłem powiązania będzie artykuł, z którego pochodzi ten fakt.
        </v-alert>
        <v-alert
          v-else
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="promote-fact-no-source"
        >
          Ten fakt nie jest powiązany ze stroną artykułu w bazie, więc
          powiązanie powstanie bez źródła.
        </v-alert>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="promote-fact-error"
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
          data-testid="promote-fact-submit"
          @click="submit()"
        >
          Utwórz powiązanie
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Turns one extracted fact into a relation in the graph.
 *
 * The gap this fills: until now a reviewer could vote a fact correct and there
 * was nothing that vote led to - nothing read the verdict, and the only way to
 * record what the fact said was to retype it into the generic edge form on
 * somebody's page.
 *
 * Half of the relation is known and half is asked. `personNodeId` is resolved at
 * ingest against the article's confirmed people, so the subject is certain; the
 * far end is a free string the article used, which nothing in the app resolves
 * to a node, so the reader picks it. The edge is written as a draft through
 * /api/edges/create, which stores it under an id derived from its identity - so
 * promoting the same fact twice lands on the one document.
 */
import { computed, ref, watch } from "vue";
import { mdiArrowRight } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { factConnector, type FactEdgeRule } from "~/utils/extraction";
import type { ExtractionFact, Link, NodeType } from "~~/shared/model";
import {
  relationNeedsReverse,
  reverseRelationSuggestions,
} from "~~/shared/relations";

const props = defineProps<{
  modelValue: boolean;
  fact: ExtractionFact;
  rule: FactEdgeRule;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  created: [edgeId: string];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const target = ref<Link<NodeType> | undefined>(undefined);
const name = ref("");
const reverseName = ref("");
const startDate = ref("");
const endDate = ref("");
const saving = ref(false);
const error = ref<string | null>(null);

const verb = computed(() => factConnector(props.fact));

/** What the article called the far end, so the reader knows what to look for. */
const targetHint = computed(
  () =>
    props.fact.organization ||
    props.fact.object ||
    props.fact.affair ||
    "nie podano",
);

const nameLabel = computed(() => {
  if (props.rule.edgeType === "employed") return "Stanowisko / rola";
  // A personal tie: named as a pair either side of an arrow, so the two fields
  // say which reading each of them is - see `FormRelationDetailFields`.
  return target.value
    ? `${props.fact.personNodeName} → ${target.value.name}`
    : "Rodzaj relacji";
});

const reverseNameLabel = computed(() =>
  target.value
    ? `${target.value.name} → ${props.fact.personNodeName}`
    : "A w drugą stronę",
);

/** What the other side is probably called, given the word the article used.
 * Dropped once the field already says one of them. */
const reverseSuggestions = computed(() => {
  if (props.rule.edgeType !== "connection") return [];
  return reverseRelationSuggestions(name.value).filter(
    (option) => option !== reverseName.value,
  );
});

function dateRule(value: string) {
  if (!value) return true;
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) || "Format: RRRR-MM-DD";
}

const readyToSubmit = computed(
  () =>
    !!target.value &&
    target.value.id !== props.fact.personNodeId &&
    dateRule(startDate.value) === true &&
    dateRule(endDate.value) === true &&
    // Same rule as the hand-typed forms: a named personal tie owes both of its
    // readings, or promoting a fact would quietly refill the queue this
    // feature exists to empty.
    !relationNeedsReverse({
      type: props.rule.edgeType,
      name: name.value,
      reverse_name: reverseName.value,
    }),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  target.value = undefined;
  error.value = null;
  // Prefilled from the fact rather than left blank: the role the article gave
  // is the thing being recorded, and retyping it is where a promotion stops
  // being cheaper than the generic form.
  name.value = props.rule.label(props.fact);
  reverseName.value = "";
  startDate.value = "";
  endDate.value = "";
});

async function submit() {
  if (!readyToSubmit.value || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const { id } = await authRequest<{ id: string }>("/api/edges/create", {
      method: "POST",
      body: {
        source: props.fact.personNodeId,
        target: target.value!.id,
        type: props.rule.edgeType,
        name: name.value,
        reverse_name: reverseName.value,
        start_date: startDate.value,
        end_date: endDate.value,
        references: props.fact.articleNodeId ? [props.fact.articleNodeId] : [],
      },
    });
    emit("created", id);
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

<style scoped>
.quote {
  border-left: 3px solid rgba(var(--v-border-color), 0.4);
  color: rgba(var(--v-theme-on-surface), 0.75);
  padding-left: 12px;
}
</style>

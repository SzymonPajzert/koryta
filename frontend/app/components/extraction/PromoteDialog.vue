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

        <!-- The same relation was already stored - by an earlier promotion of
             this fact, or by somebody's „Dodaj” on the person's page - and the
             endpoint handed back its id rather than writing a second one.
             Said here, in the dialog the reader is looking at: closing as if
             it had just been made would claim a relation they did not add. -->
        <v-alert
          v-if="outcome === 'exists'"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="promote-fact-exists"
        >
          To powiązanie już jest w bazie, więc nie dodaliśmy drugiego - ten fakt
          prowadzi teraz do niego.
        </v-alert>
        <!-- The same identity, but an administrator removed it. Writing it
             again would undo that removal with nobody reviewing it, so the
             endpoint leaves it gone and the fact unmarked, and says why. -->
        <v-alert
          v-else-if="outcome === 'deleted'"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="promote-fact-deleted"
        >
          Takie powiązanie było już w bazie, ale administrator je usunął, więc
          nie dodaliśmy go ponownie.
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn v-if="outcome" variant="text" @click="open = false">
          Zamknij
        </v-btn>
        <template v-else>
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
        </template>
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
 * promoting the same fact twice lands on the one document, and the dialog says
 * that is what happened. The request names the fact, which then records the
 * relation it became: that is what lets its card stop offering this.
 */
import { computed, ref, watch } from "vue";
import { mdiArrowRight } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { factConnector, type FactEdgeRule } from "~/utils/extraction";
import type { ExtractionFact, Link, NodeType } from "~~/shared/model";

const props = defineProps<{
  modelValue: boolean;
  fact: ExtractionFact;
  rule: FactEdgeRule;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** The fact now stands for this relation - one just made, or the one that
   * was already stored under the same identity. */
  promoted: [edgeId: string];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const target = ref<Link<NodeType> | undefined>(undefined);
const name = ref("");
const startDate = ref("");
const endDate = ref("");
const saving = ref(false);
const error = ref<string | null>(null);
/** Set when the endpoint wrote nothing: the relation is already stored, or
 * was and an administrator removed it. */
const outcome = ref<"exists" | "deleted" | null>(null);

const verb = computed(() => factConnector(props.fact));

/** What the article called the far end, so the reader knows what to look for. */
const targetHint = computed(
  () =>
    props.fact.organization ||
    props.fact.object ||
    props.fact.affair ||
    "nie podano",
);

const nameLabel = computed(() =>
  props.rule.edgeType === "employed" ? "Stanowisko / rola" : "Rodzaj relacji",
);

function dateRule(value: string) {
  if (!value) return true;
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) || "Format: RRRR-MM-DD";
}

const readyToSubmit = computed(
  () =>
    !!target.value &&
    target.value.id !== props.fact.personNodeId &&
    dateRule(startDate.value) === true &&
    dateRule(endDate.value) === true,
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  target.value = undefined;
  error.value = null;
  outcome.value = null;
  // Prefilled from the fact rather than left blank: the role the article gave
  // is the thing being recorded, and retyping it is where a promotion stops
  // being cheaper than the generic form.
  name.value = props.rule.label(props.fact);
  startDate.value = "";
  endDate.value = "";
});

async function submit() {
  if (!readyToSubmit.value || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const { id, created, deleted } = await authRequest<{
      id: string;
      created: boolean;
      deleted?: boolean;
    }>("/api/edges/create", {
      method: "POST",
      body: {
        source: props.fact.personNodeId,
        target: target.value!.id,
        type: props.rule.edgeType,
        name: name.value,
        start_date: startDate.value,
        end_date: endDate.value,
        references: props.fact.articleNodeId ? [props.fact.articleNodeId] : [],
        // Left off for a fact with no id - a grouped listing can hand one
        // over - which then simply records nothing on the fact.
        ...(props.fact.id ? { extraction: props.fact.id } : {}),
      },
    });
    if (deleted) {
      outcome.value = "deleted";
      return;
    }
    // New or already there, the fact now stands for a live relation, so the
    // card is told; only a new one closes the dialog without a word.
    emit("promoted", id);
    if (created === false) {
      outcome.value = "exists";
    } else {
      open.value = false;
    }
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

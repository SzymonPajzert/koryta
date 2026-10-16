<template>
  <v-dialog v-model="open" max-width="560">
    <v-card data-testid="remove-edge-dialog">
      <v-card-title class="pb-1">Usuń powiązanie</v-card-title>
      <v-card-subtitle class="pb-3 text-wrap">
        {{ edgeLabel }}
      </v-card-subtitle>

      <v-card-text class="pt-0">
        <p class="mb-4 text-body-2">
          Powiązanie zniknie ze strony i z grafu. Zostaje w bazie razem z
          powodem, więc widać potem, kto i dlaczego je zdjął - ale nikt tej
          decyzji nie zatwierdza po tobie i żaden ekran jej nie cofa.
        </p>

        <v-textarea
          v-model="reason"
          label="Powód usunięcia"
          placeholder="np. Błędnie scalona osoba, Duplikat, Dane nieprawdziwe"
          data-testid="remove-edge-reason"
          auto-grow
          rows="2"
          :error-messages="reasonError"
        />

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          data-testid="remove-edge-error"
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
          :loading="saving"
          :disabled="!reason.trim()"
          data-testid="remove-edge-confirm"
          @click="confirm()"
        >
          Usuń powiązanie
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** An administrator taking one relation off the graph, and saying why.
 *
 * Not `DialogProposeRemoval`, which files a proposal for somebody to review.
 * The case this exists for is a relation that is nobody's claim - the employers
 * that came off the wrong half of a wrongly merged person - and there is no
 * second opinion to wait for. The reason is still required, because the removal
 * revision it writes is the only record of why the relation went.
 *
 * One dialog per page rather than one per row: a person with fifty relations
 * would otherwise mount fifty of them. The caller passes whichever relation the
 * reader clicked, which is also why this takes an id and a caption rather than
 * an edge - each page holds a different shape of the same thing.
 */
import { computed, ref, watch } from "vue";
import { authRequest } from "~/composables/auth";
import type { EdgeDeleted } from "~~/server/api/edges/delete.post";

const props = defineProps<{
  modelValue: boolean;
  /** The relation being removed. */
  edgeId: string;
  /** How the relation reads on the page it was opened from, so the dialog says
   * which one is about to go. */
  edgeLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** The relation is gone; the caller refetches rather than patching its list. */
  removed: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const reason = ref("");
const saving = ref(false);
const error = ref<string | null>(null);
const reasonError = ref<string | null>(null);

// A fresh reason every time it opens. Carrying the last one over is how the
// wrong justification ends up on the record for a relation it was never about.
watch(open, (isOpen) => {
  if (!isOpen) return;
  reason.value = "";
  error.value = null;
  reasonError.value = null;
});

async function confirm() {
  const trimmed = reason.value.trim();
  if (!trimmed) {
    reasonError.value = "Powód usunięcia jest wymagany";
    return;
  }

  saving.value = true;
  error.value = null;
  reasonError.value = null;
  try {
    await authRequest<EdgeDeleted>("/api/edges/delete", {
      body: { edge_id: props.edgeId, reason: trimmed },
    });
    open.value = false;
    emit("removed");
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się usunąć powiązania.";
  } finally {
    saving.value = false;
  }
}
</script>

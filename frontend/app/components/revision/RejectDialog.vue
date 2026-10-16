<template>
  <v-dialog v-model="open" max-width="480">
    <v-card data-testid="reject-dialog">
      <v-card-title>Odrzuć rewizję</v-card-title>
      <v-card-subtitle v-if="targetName" class="text-wrap pb-2">
        {{ targetName }}
      </v-card-subtitle>
      <v-card-text>
        <p class="mb-1 text-body-2">
          Rewizja zostaje zachowana wraz z powodem - to jedyne, co wróci do
          osoby, która ją zgłosiła.
        </p>
        <p class="mb-3 text-body-2 text-medium-emphasis">
          Autor dostanie ten powód mailem.
        </p>
        <v-textarea
          v-model="reason"
          label="Powód odrzucenia"
          placeholder="np. brak źródła, dane niezgodne z KRS"
          rows="3"
          auto-grow
          data-testid="reject-reason"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          color="error"
          :disabled="!reason.trim()"
          :loading="loading"
          data-testid="reject-confirm"
          @click="emit('confirm', reason.trim())"
        >
          Odrzuć
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Asking for the reason a revision is turned down.
 *
 * The reason is not bookkeeping: it is the whole of what its author ever hears
 * back, and since the notification mail carries it, whatever is typed here is
 * read by a person. The dialog only collects it - the caller runs the request
 * and closes the dialog when it succeeds, which is why `loading` comes in as a
 * prop rather than being kept here.
 */
import { ref, watch } from "vue";

defineProps<{
  loading?: boolean;
  /** The entry the revision is filed against, so a reviewer working through a
   * queue can see which one they are about to reject. */
  targetName?: string | null;
}>();

const emit = defineEmits<{ confirm: [reason: string] }>();

const open = defineModel<boolean>({ required: true });
const reason = ref("");

// Cleared on every opening, or the next revision inherits the last one's
// reason - which would be sent to its author as though it were about them.
watch(open, (value) => {
  if (value) reason.value = "";
});
</script>

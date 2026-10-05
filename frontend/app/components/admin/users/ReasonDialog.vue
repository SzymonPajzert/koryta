<template>
  <v-dialog v-model="open" max-width="480">
    <v-card data-reason-dialog>
      <v-card-title class="text-wrap">{{ title }}</v-card-title>
      <v-card-text>
        <p v-if="text" class="mb-3 text-body-2">{{ text }}</p>
        <v-textarea
          v-model="reason"
          :label="required ? 'Powód' : 'Powód (nieobowiązkowo)'"
          :hint="hint"
          persistent-hint
          :counter="limits.max"
          rows="2"
          auto-grow
          data-reason-input
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="open = false">
          Anuluj
        </v-btn>
        <v-btn
          :color="color"
          variant="flat"
          :disabled="!valid"
          :loading="loading"
          data-reason-confirm
          @click="emit('confirm', reason.trim())"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/** Asks why, before a decision about somebody's account is sent.
 *
 * Every change made from the users page lands in `userActions` with its
 * reason, and the owner reads a nomination's reason before he says y in the
 * script - so for those it is required, with the same bounds the route checks.
 * Withdrawing a nomination or turning down a request changes nobody's role, and
 * the reason there is a courtesy to whoever reads the history later.
 *
 * Like `RevisionRejectDialog`, it only collects: the caller sends the request
 * and closes the dialog when it went through, so a refusal keeps what was
 * typed. */
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    /** What the decision does, in a sentence or two. */
    text?: string;
    confirmLabel: string;
    color?: string;
    required?: boolean;
    limits: { min: number; max: number };
    hint?: string;
    loading?: boolean;
  }>(),
  {
    text: undefined,
    color: "primary",
    required: false,
    hint: "Zostanie w historii konta.",
    loading: false,
  },
);

const emit = defineEmits<{ confirm: [reason: string] }>();

const open = defineModel<boolean>({ required: true });
const reason = ref("");

const valid = computed(() => {
  const length = reason.value.trim().length;
  if (length > props.limits.max) return false;
  return props.required ? length >= props.limits.min : true;
});

// Cleared on every opening: a reason typed for one account must not be sent
// for the next one the same dialog is opened on.
watch(open, (value) => {
  if (value) reason.value = "";
});
</script>

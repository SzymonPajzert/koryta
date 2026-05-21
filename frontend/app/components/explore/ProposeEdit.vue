<template>
  <div v-if="user" class="mb-4">
    <div class="d-flex justify-space-between align-center mb-2">
      <div class="text-caption text-medium-emphasis">
        Wiesz więcej o tej osobie?
      </div>
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        prepend-icon="mdi-pencil"
        @click="dialog = true"
      >
        Zaproponuj edycję
      </v-btn>
    </div>

    <!-- Read-only display of current content if it exists -->
    <div v-if="person.content" class="text-body-2 mb-2 bg-grey-lighten-4 pa-3 rounded">
      {{ person.content }}
    </div>
    
    <!-- Read-only display of parties if they exist -->
    <div v-if="person.parties && person.parties.length > 0" class="mb-2">
      <v-chip
        v-for="party in person.parties"
        :key="party"
        size="small"
        class="mr-1 mb-1"
      >
        {{ party }}
      </v-chip>
    </div>

    <v-dialog v-model="dialog" max-width="600px">
      <v-card>
        <v-card-title>Zaproponuj zmiany dla {{ person.name }}</v-card-title>
        <v-card-text>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Twoje zmiany muszą zostać zatwierdzone. Jako zalogowany użytkownik,
            będziesz je widział natychmiast jako wariant szkicowy.
          </div>

          <v-combobox
            v-model="editedParties"
            :items="availableParties"
            label="Partie polityczne"
            multiple
            chips
            closable-chips
            class="mb-2"
          ></v-combobox>

          <v-textarea
            v-model="editedContent"
            label="Krótkie podsumowanie (opis)"
            rows="4"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="dialog = false" :disabled="loading">Anuluj</v-btn>
          <v-btn
            color="primary"
            @click="submitProposal"
            :loading="loading"
          >
            Zgłoś propozycję
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useCurrentUser } from "vuefire";
import type { PersonRich } from "~~/shared/model";
import { parties } from "~~/shared/misc";

const props = defineProps<{
  person: PersonRich;
}>();

const user = useCurrentUser();
const dialog = ref(false);
const loading = ref(false);

const availableParties = parties;

const editedParties = ref([...(props.person.parties || [])]);
const editedContent = ref(props.person.content || "");

// Reset when dialog opens or person changes
watch(() => props.person, () => {
  editedParties.value = [...(props.person.parties || [])];
  editedContent.value = props.person.content || "";
});

watch(dialog, (val) => {
  if (val) {
    editedParties.value = [...(props.person.parties || [])];
    editedContent.value = props.person.content || "";
  }
});

const emit = defineEmits<{
  (e: 'proposed'): void
}>();

const submitProposal = async () => {
  if (!user.value) return;

  loading.value = true;

  try {
    const operations = [];

    const originalParties = props.person.parties || [];
    for (const p of editedParties.value) {
      if (!originalParties.includes(p)) {
        operations.push({ op: "add", field: "parties", value: p });
      }
    }
    for (const p of originalParties) {
      if (!editedParties.value.includes(p)) {
        operations.push({ op: "remove", field: "parties", value: p });
      }
    }

    const originalContent = props.person.content || "";
    if (editedContent.value !== originalContent) {
      operations.push({
        op: "replace",
        field: "content",
        value: editedContent.value,
      });
    }

    if (operations.length > 0) {
      await $fetch(`/api/nodes/${props.person.id}/propose`, {
        method: "POST",
        body: { operations },
      });
      emit('proposed');
    }

    dialog.value = false;
  } catch (e) {
    console.error("Failed to submit proposal", e);
  } finally {
    loading.value = false;
  }
};
</script>

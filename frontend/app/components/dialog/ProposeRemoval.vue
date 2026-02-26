<template>
  <v-dialog v-model="dialog" max-width="500">
    <template #activator="{ props }">
      <slot name="activator" :props="props">
        <v-btn
          v-bind="props"
          color="error"
          variant="tonal"
          prepend-icon="mdi-delete-outline"
        >
          Zaproponuj usunięcie
        </v-btn>
      </slot>
    </template>

    <v-card>
      <v-card-title>Zaproponuj usunięcie</v-card-title>
      <v-card-text>
        <p class="mb-4">
          Wskazanie usunięcia jest specjalnym rodzajem rewizji. Wymaga podania
          powodu.
        </p>
        <v-textarea
          id="delete-reason-input"
          v-model="reason"
          placeholder="Powód usunięcia, np. Duplikat, Dane nieprawdziwe"
          auto-grow
          rows="3"
        />
        <v-alert v-if="error" type="error" class="mt-2">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">Anuluj</v-btn>
        <v-btn
          color="error"
          :loading="loading"
          :disabled="!reason.trim()"
          @click="submit"
        >
          Zaproponuj usunięcie
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string; // node_id or edge_id
  type?: string;
  name?: string;
  collection?: "nodes" | "edges";
}>();

const emit = defineEmits<{
  (e: "success"): void;
}>();

const dialog = ref(false);
const reason = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const { authFetch } = useAuthState();

async function submit() {
  loading.value = true;
  error.value = null;

  try {
    const body: any = {
      node_id: props.id,
      deleted: true,
      delete_reason: reason.value,
      collection: props.collection || "nodes",
    };

    if (props.type) body.type = props.type;
    if (props.name) body.name = props.name;

    await authFetch("/api/revisions/create", {
      method: "POST",
      body,
    });
    dialog.value = false;
    reason.value = "";
    emit("success");
  } catch (e: any) {
    error.value = e.message || "Wystąpił błąd";
  } finally {
    loading.value = false;
  }
}
</script>

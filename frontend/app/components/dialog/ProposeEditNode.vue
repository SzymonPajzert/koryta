<template>
  <div class="d-inline-block">
    <slot name="activator" :props="{ onClick: handleActivatorClick }">
      <v-btn
        icon
        border="sm current"
        class="text-none pa-1 me-2"
        color="warning"
        rounded="lg"
        size="44"
        variant="outlined"
        @click="handleActivatorClick"
      >
        <v-icon :icon="mdiPencilOutline" color="warning" />
        <span style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;">Zaproponuj zmianę</span>
        <v-tooltip activator="parent" location="top">Zaproponuj zmianę</v-tooltip>
      </v-btn>
    </slot>

    <v-dialog v-model="dialog" max-width="600">
      <v-card>
        <v-card-title>Zaproponuj zmianę</v-card-title>
        <v-card-text>
          <p class="mb-4">
            Zaproponuj nowe dane dla tego wpisu. Zmiany będą musiały zostać
            zatwierdzone.
          </p>
          <v-form ref="form" @submit.prevent="submit">
            <v-text-field
              v-model="editData.name"
              label="Nazwa / Imię i nazwisko"
              required
              class="mb-2"
            />
            <template v-if="entity.type === 'person'">
              <v-select
                v-model="editData.parties"
                :items="parties"
                label="Przynależność partyjna"
                multiple
                chips
                clearable
                class="mb-2"
              />
            </template>
            <v-textarea
              v-model="editData.content"
              label="Treść (opcjonalnie)"
              auto-grow
              rows="5"
            />
          </v-form>
          <v-alert v-if="error" type="error" class="mt-2">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Anuluj</v-btn>
          <v-btn color="primary" :loading="loading" @click="submit">
            Zaproponuj
          </v-btn>
        </v-card-actions>
      </v-card></v-dialog
    >

    <DialogLogin
      v-model="loginDialog"
      hide-activator
      @success="onLoginSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { mdiPencilOutline } from "@mdi/js";
import { authFetch } from "@/composables/auth";
import { parties } from "~~/shared/misc";

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: "success"): void;
}>();

const dialog = ref(false);
const loginDialog = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const user = useCurrentUser();
const router = useRouter();
const route = useRoute();

const handleActivatorClick = () => {
  if (user.value) {
    dialog.value = true;
  } else {
    loginDialog.value = true;
  }
};

const onLoginSuccess = () => {
  dialog.value = true;
};

const editData = reactive({
  name: "",
  content: "",
  parties: [] as string[],
});

watch(dialog, (val) => {
  if (val) {
    editData.name = props.entity.name || "";
    editData.content = props.entity.content || "";
    if (props.entity.type === "person") {
      editData.parties = Array.isArray(props.entity.parties)
        ? [...props.entity.parties]
        : [];
    }
  }
});

async function submit() {
  if (!editData.name.trim()) {
    error.value = "Nazwa jest wymagana";
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const body: Record<string, unknown> = {
      node_id: props.entity.id,
      name: editData.name,
      content: editData.content,
    };

    if (props.entity.type === "person") {
      body.parties = editData.parties;
    }

    const { data: response } = await authFetch<{ id: string }>(
      "/api/revisions/create",
      {
        method: "POST",
        body,
      },
    );
    dialog.value = false;
    emit("success");

    // Redirect to the same page with the revisionId to show their proposed changes
    if (response.value?.id) {
      router.push({
        path: route.path,
        query: { ...route.query, revisionId: response.value.id },
      });
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Wystąpił błąd";
  } finally {
    loading.value = false;
  }
}
</script>

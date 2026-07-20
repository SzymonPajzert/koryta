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
        <v-icon
          :icon="isCreate ? mdiAccountPlusOutline : mdiPencilOutline"
          color="warning"
        />
        <span
          style="
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          "
          >{{ title }}</span
        >
        <v-tooltip activator="parent" location="top">{{ title }}</v-tooltip>
      </v-btn>
    </slot>

    <v-dialog v-model="dialog" max-width="600">
      <v-card>
        <v-card-title>{{ title }}</v-card-title>
        <v-card-text>
          <p class="mb-4">
            {{
              isCreate
                ? "Zaproponuj nowy wpis. Wystarczy imię i nazwisko, pozostałe pola są opcjonalne. Wpis będzie musiał zostać zatwierdzony."
                : "Zaproponuj nowe dane dla tego wpisu. Zmiany będą musiały zostać zatwierdzone."
            }}
          </p>
          <v-form ref="form" @submit.prevent="submit">
            <v-text-field
              v-model="editData.name"
              label="Nazwa / Imię i nazwisko"
              required
              class="mb-2"
            />
            <template v-if="type === 'person'">
              <v-select
                v-model="editData.parties"
                :items="parties"
                label="Przynależność partyjna"
                multiple
                chips
                clearable
                class="mb-2"
              />
              <v-text-field
                v-model="editData.wikipedia"
                label="Link do Wikipedii"
                hint="Pełny link do artykułu"
                persistent-hint
                class="mb-2"
              />
              <v-text-field
                v-model="editData.rejestrIo"
                label="Link do Rejestr.io"
                hint="Pełny link do profilu"
                persistent-hint
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
import { ref, reactive, computed, watch } from "vue";
import { mdiAccountPlusOutline, mdiPencilOutline } from "@mdi/js";
import { authFetch } from "@/composables/auth";
import { generateEntityUrl } from "~/composables/slugs";
import { parties } from "~~/shared/misc";
import type { NodeType } from "~~/shared/model";

const props = defineProps<{
  /** Omitted when proposing a brand new node instead of an edit. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity?: Record<string, any>;
  /** Type of the node to create, only used when there is no `entity`. */
  createType?: NodeType;
  skipRedirect?: boolean;
}>();

const emit = defineEmits<{
  (e: "success"): void;
  (e: "submitted" | "created", id: string): void;
}>();

const isCreate = computed(() => !props.entity);
const type = computed<NodeType>(
  () => props.entity?.type ?? props.createType ?? "person",
);
const title = computed(() =>
  isCreate.value
    ? type.value === "person"
      ? "Zaproponuj dodanie osoby"
      : "Zaproponuj dodanie wpisu"
    : "Zaproponuj zmianę",
);

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
  wikipedia: "",
  rejestrIo: "",
});

watch(dialog, (val) => {
  if (!val) return;
  // Prefill from the edited entity, or start blank when proposing a new one
  const entity = props.entity ?? {};
  editData.name = entity.name || "";
  editData.content = entity.content || "";
  editData.parties = Array.isArray(entity.parties) ? [...entity.parties] : [];
  editData.wikipedia = entity.wikipedia || "";
  editData.rejestrIo = entity.rejestrIo || "";
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
      name: editData.name,
      content: editData.content,
    };

    if (isCreate.value) {
      body.type = type.value;
    } else {
      body.node_id = props.entity!.id;
    }

    if (type.value === "person") {
      body.parties = editData.parties;
      body.wikipedia = editData.wikipedia;
      body.rejestrIo = editData.rejestrIo;
    }

    const { data: response } = await authFetch<{ id: string; node_id: string }>(
      "/api/revisions/create",
      {
        method: "POST",
        body,
      },
    );
    dialog.value = false;
    emit("success");

    if (response.value?.id) {
      emit("submitted", response.value.id);
      if (isCreate.value && response.value.node_id) {
        emit("created", response.value.node_id);
      }

      // When skipRedirect is set, the parent handles showing the revision
      // (e.g., the tabela side panel shows the link inline)
      if (!props.skipRedirect) {
        // A newly created node lives under its own url, an edit stays in place
        const path =
          isCreate.value && response.value.node_id
            ? generateEntityUrl(
                type.value,
                response.value.node_id,
                editData.name,
              )
            : route.path;
        router.push({
          path,
          query: isCreate.value
            ? { revisionId: response.value.id }
            : { ...route.query, revisionId: response.value.id },
        });
      }
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Wystąpił błąd";
  } finally {
    loading.value = false;
  }
}
</script>

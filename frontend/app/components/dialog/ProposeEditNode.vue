<template>
  <div class="d-inline-block">
    <slot
      v-if="!hideActivator"
      name="activator"
      :props="{ onClick: handleActivatorClick }"
    >
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
                v-model="editData.birthDate"
                label="Data urodzenia"
                type="date"
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
              <v-text-field
                v-model="editData.ktomaco"
                label="Link do Kto ma co"
                hint="Pełny link do profilu w ktomaco.pl"
                persistent-hint
                class="mb-2"
              />
            </template>
            <template v-if="type === 'place'">
              <v-text-field
                v-model="editData.krsNumber"
                label="Numer KRS"
                hint="Numer w Krajowym Rejestrze Sądowym, jeśli podmiot jest w nim wpisany"
                persistent-hint
                class="mb-2"
              />
              <v-text-field
                v-model="editData.regonNumber"
                label="Numer REGON"
                hint="9 lub 14 cyfr. Mają go też ministerstwa, urzędy i fundusze, których nie ma w KRS"
                persistent-hint
                :rules="[identifierRule(isValidRegon, 'REGON')]"
                class="mb-2"
              />
              <v-text-field
                v-model="editData.nipNumber"
                label="Numer NIP"
                hint="10 cyfr"
                persistent-hint
                :rules="[identifierRule(isValidNip, 'NIP')]"
                class="mb-2"
              />
              <v-select
                v-model="editData.isPublic"
                :items="ownershipOptions"
                label="Właściciel"
                hint="KRS nie ujawnia akcjonariuszy spółek akcyjnych, a ministerstwa i urzędy nie mają w nim wpisu - dlatego pytamy."
                persistent-hint
                class="mb-2"
              />
            </template>
            <template v-if="type === 'article'">
              <v-text-field
                v-model="editData.sourceURL"
                label="Adres źródła"
                hint="Pełny link do artykułu, np. https://wiadomosci.wp.pl/..."
                persistent-hint
                :rules="[urlRule]"
                class="mb-2"
              />
              <v-text-field
                v-model="editData.shortName"
                label="Skrócona nazwa (opcjonalnie)"
                hint="np. WP, Onet - używana tam, gdzie tytuł się nie mieści"
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
import { authRequest } from "@/composables/auth";
import { generateEntityUrl } from "~/composables/slugs";
import { parties } from "~~/shared/misc";
import { publicSectorKnown, type NodeType } from "~~/shared/model";
import { isValidNip, isValidRegon } from "~~/shared/identifiers";

const props = defineProps<{
  /** Omitted when proposing a brand new node instead of an edit. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity?: Record<string, any>;
  /** Type of the node to create, only used when there is no `entity`. */
  createType?: NodeType;
  /** Prefills the name when creating, e.g. with the search query it started from. */
  initialName?: string;
  /** Hides the built in activator, for callers that open the dialog via `open()`. */
  hideActivator?: boolean;
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
const createTitles: Record<string, string> = {
  person: "Zaproponuj dodanie osoby",
  place: "Zaproponuj dodanie instytucji",
  article: "Zaproponuj dodanie źródła",
};

const title = computed(() =>
  isCreate.value
    ? (createTitles[type.value] ?? "Zaproponuj dodanie wpisu")
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

// Lets a parent open the dialog without rendering an activator of its own,
// while keeping the "log in first" gating in one place.
defineExpose({ open: handleActivatorClick });

/** `null` is "we still don't know", which is the honest answer for most places
 * and the one the scrapers cannot distinguish from "privately owned". */
const ownershipOptions = [
  { title: "Nie wiem", value: null },
  { title: "Skarb państwa lub samorząd", value: true },
  { title: "Podmiot prywatny", value: false },
];

const editData = reactive({
  name: "",
  content: "",
  parties: [] as string[],
  birthDate: "",
  wikipedia: "",
  rejestrIo: "",
  krsNumber: "",
  regonNumber: "",
  nipNumber: "",
  isPublic: null as boolean | null,
  ktomaco: "",
  sourceURL: "",
  shortName: "",
});

/** An article is identified by its address, so a typo there creates a second
 * copy of a source rather than pointing at the one already stored. */
const urlRule = (value: string) =>
  !value || URL.canParse(value) || "Podaj pełny adres, razem z https://";

/** Says so before the request rather than after it, since both numbers carry a
 * check digit and the server rejects a wrong one anyway. */
const identifierRule =
  (isValid: (value: string) => boolean, register: string) => (value: string) =>
    !value || isValid(value) || `Numer ${register} jest niepoprawny`;

/** Identifiers are sent as typed, so clearing a wrong number really clears it -
 * but only once there is something to say, or an institution outside a register
 * would gain a blank field it never had. */
const identifierFields = ["krsNumber", "regonNumber", "nipNumber"] as const;

watch(dialog, (val) => {
  if (!val) return;
  // Prefill from the edited entity, or from `initialName` when proposing a new one
  const entity = props.entity ?? {};
  editData.name = entity.name || props.initialName || "";
  editData.content = entity.content || "";
  editData.parties = Array.isArray(entity.parties) ? [...entity.parties] : [];
  editData.birthDate = entity.birthDate || "";
  editData.wikipedia = entity.wikipedia || "";
  editData.rejestrIo = entity.rejestrIo || "";
  editData.krsNumber = entity.krsNumber || "";
  editData.regonNumber = entity.regonNumber || "";
  editData.nipNumber = entity.nipNumber || "";
  // A scraped `false` prefills as "nie wiem": it means KRS had nothing to say,
  // so offering it back as an answer would launder a gap into a fact.
  editData.isPublic = publicSectorKnown(entity) ? !!entity.isPublic : null;
  editData.ktomaco = entity.ktomaco || "";
  editData.sourceURL = entity.sourceURL || "";
  editData.shortName = entity.shortName || "";
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
      body.birthDate = editData.birthDate;
      body.wikipedia = editData.wikipedia;
      body.rejestrIo = editData.rejestrIo;
      body.ktomaco = editData.ktomaco;
    }

    if (type.value === "place") {
      for (const field of identifierFields) {
        if (editData[field] || props.entity?.[field]) {
          body[field] = editData[field];
        }
      }
      // Left out when unanswered, so that "nie wiem" does not get recorded as
      // somebody having decided the place is private.
      if (editData.isPublic !== null) {
        body.isPublic = editData.isPublic;
      }
    }

    if (type.value === "article") {
      body.sourceURL = editData.sourceURL;
      if (editData.shortName) body.shortName = editData.shortName;
    }

    const response = await authRequest<{ id: string; node_id: string }>(
      "/api/revisions/create",
      {
        method: "POST",
        body,
      },
    );
    dialog.value = false;
    emit("success");

    if (response.id) {
      emit("submitted", response.id);
      if (isCreate.value && response.node_id) {
        emit("created", response.node_id);
      }

      // When skipRedirect is set, the parent handles showing the revision
      // (e.g., the tabela side panel shows the link inline)
      if (!props.skipRedirect) {
        // A newly created node lives under its own url, an edit stays in place
        const path =
          isCreate.value && response.node_id
            ? generateEntityUrl(type.value, response.node_id, editData.name)
            : route.path;
        router.push({
          path,
          query: isCreate.value
            ? { revisionId: response.id }
            : { ...route.query, revisionId: response.id },
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

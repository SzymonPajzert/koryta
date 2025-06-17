<template>
  <div>
    <v-dialog
    v-model="dialog"
    max-width="600"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <slot>
        <!-- If user is logged in, show button to open dialog -->
        <v-btn
          v-if="user"
          :text="props.text"
          v-bind="activatorProps"
        ></v-btn>
        <!-- If user is not logged in, show button to redirect to login -->
        <v-btn
          v-else
          :text="props.text"
          to="/login"
        ></v-btn>
      </slot>
    </template>

    <v-card
      prepend-icon="mdi-account"
      title="Dodaj nową osobę"
    >
      <v-card-text>
        <v-row dense>
          <v-col
            cols="12"
            md="12"
          >
            <v-text-field
              v-model="formData.name"
              :label="`Imię i nazwisko ${koryciarz.singular.accusative}`"
              hint="Osoba zatrudniona w publicznej firmie"
              autocomplete="off"
              required
            ></v-text-field>
          </v-col>

          <v-col
            cols="12"
            md="8"
            sm="12"
          >
            <v-text-field
              v-model="formData.source"
              label="Źródło"
              hint="Link do artykułu"
              autocomplete="off"
              required
            ></v-text-field>
          </v-col>

          <v-col
            cols="12"
            md="4"
            sm="6"
          >
            <v-select
              v-model="formData.parties"
              :items="partiesDefault"
              label="Partia"
              multiple
              chips
              deletable-chips
              required
            ></v-select>
          </v-col>

          <!-- Dynamic fields for Employments -->
          <MultiTextField
            title="Zatrudnienie"
            v-model="formData.employments"
            hint="np. Członek rady nadzorczej XYZ sp. z o.o."
            add-item-tooltip="Dodaj kolejne zatrudnienie"
            remove-item-tooltip="Usuń zatrudnienie"
          />
          <MultiTextField
            title="Koneksja"
            v-model="formData.connections"
            hint="np. Znajomy ministra"
            add-item-tooltip="Dodaj kolejną koneksję"
            remove-item-tooltip="Usuń koneksję"
          />
          <MultiTextField
            title="Inna uwaga"
            v-model="formData.comments"
            field-type="textarea"
            hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
            add-item-tooltip="Dodaj kolejną uwagę"
            remove-item-tooltip="Usuń uwagę"
          />
        </v-row>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-spacer></v-spacer>

        <v-btn
          text="Zamknij"
          variant="plain"
          @click="dialog = false"
        ></v-btn>

        <v-btn
          color="primary"
          text="Dodaj"
          variant="tonal"
          @click="saveSuggestion"
        ></v-btn>
      </v-card-actions>
    </v-card>
    </v-dialog>

    <v-snackbar
      v-model="showConfirmationSnackbar"
      :timeout="3000"
      color="success"
      location="top end"
    >
      Sugestia została pomyślnie dodana!
      <template v-slot:actions>
        <v-btn
          variant="text"
          @click="showConfirmationSnackbar = false"
        >
          Zamknij
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
  import { useFeminatyw } from '@/composables/feminatyw';
  import { useAuthState } from '@/composables/auth'
  import { usePartyStatistics, type NepoEmployment } from '@/composables/party';
  import { useReadDB } from '@/composables/staticDB'

  import { shallowRef, computed, ref as vueRef } from 'vue'
  import { ref as dbRef, push } from 'firebase/database';
  import MultiTextField from './MultiTextField.vue';

  interface Textable {
    text: string;
  }

  const { parties } = usePartyStatistics();
  const { user } = useAuthState();
  const { db } = useReadDB();
  const props = defineProps<{ text: string }>();

  const partiesDefault = computed<string[]>(() => [...parties.value, 'inne'])
  const { koryciarz } = useFeminatyw();

  const dialog = shallowRef(false);
  const showConfirmationSnackbar = vueRef(false);

  const initialFormData = () => ({
    name: '',
    parties: [] as string[],
    employments: [{ text: '' }] as Textable[],
    connections: [{ text: '' }] as Textable[],
    source: '',
    comments: [{ text: '' }] as Textable[],
  });

  const formData = vueRef(initialFormData());

  const arrayToKeysMap = (array: Textable[]) : Record<string, Textable> => {
    const map: Record<string, Textable> = {};
    array.forEach((elt) => {
      if (elt.text.trim() !== '') {
        const newKey = push(dbRef(db, '_temp_keys/employments')).key;
        if (!newKey) {
          throw "Failed to create a key"
        }
        map[newKey] = elt;
      }
    });
    return map;
  };

  const toOutput = (data: ReturnType<typeof initialFormData>) => {
    return {
      name: data.name,
      parties: data.parties,
      employments: arrayToKeysMap(data.employments),
      connections: arrayToKeysMap(data.connections),
      sourceURL: data.source,
      comments: arrayToKeysMap(data.comments),
    };
  };

  const saveSuggestion = () => {
    if (!user.value?.uid) {
      console.error("User not authenticated or UID not available.");
      // Można tu dodać powiadomienie dla użytkownika
      return;
    }
    const keyRef = push(dbRef(db, 'suggestions'), {
      ...toOutput(formData.value),
      date: Date.now(),
      user: user.value?.uid,
    }).key;
    push(dbRef(db, `user/${user.value?.uid}/suggestions`), keyRef)

    dialog.value = false;
    // Reset form data
    formData.value = initialFormData();
    // Show confirmation snackbar
    showConfirmationSnackbar.value = true;
  };
</script>

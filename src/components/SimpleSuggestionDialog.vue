<template>
  <v-dialog
    v-model="dialog"
    max-width="600"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <!-- If user is logged in, show button to open dialog -->
      <v-btn
        v-if="user"
        text="Dodaj"
        v-bind="activatorProps"
      ></v-btn>
      <!-- If user is not logged in, show button to redirect to login -->
      <v-btn
        v-else
        text="Dodaj"
        to="/login"
      ></v-btn>
    </template>

    <v-card
      prepend-icon="mdi-account"
      title="Dodaj nową osobę"
    >
      <v-card-text>
        <v-row dense>
          <v-col
            cols="12"
            md="6"
            sm="12"
          >
            <v-text-field
              v-model="formData.person"
              :label="koryciarz.singular.nominative"
              hint="Osoba zatrudniona w publicznej firmie"
              required
            ></v-text-field>
          </v-col>

          <v-col
            cols="12"
            md="6"
            sm="12"
          >
            <v-text-field
              v-model="formData.politician"
              :hint="`Osoba polityczna bliska ${koryciarz.singular.dative}`"
              :label="tuczyciel.singular.nominative"
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
              required
            ></v-text-field>
          </v-col>

          <v-col
            cols="12"
            md="4"
            sm="6"
          >
            <v-select
              v-model="formData.party"
              :items="partiesDefault"
              label="Partia"
              required
            ></v-select>
          </v-col>

          <v-col
            cols="12"
            md="12"
            sm="6"
          >
            <v-autocomplete
              v-model="formData.company"
              :items="companies"
              label="Miejsce zatrudnienia"
              auto-select-first
            ></v-autocomplete>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-spacer></v-spacer>

        <v-btn
          text="Close"
          variant="plain"
          @click="dialog = false"
        ></v-btn>

        <v-btn
          color="primary"
          text="Save"
          variant="tonal"
          @click="saveSuggestion"
        ></v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { useFeminatyw } from '@/composables/feminatyw';
  import { useAuthState } from '@/composables/auth'
  import { usePartyStatistics, useListEmployment } from '@/composables/party';
  import { useReadDB } from '@/composables/staticDB'

  import { shallowRef, computed, ref as vueRef } from 'vue'
  import { ref as dbRef, push } from 'firebase/database';

  const { parties } = usePartyStatistics();
  const { people } = useListEmployment();
  const { user } = useAuthState();
  const { db } = useReadDB();

  const partiesDefault = computed<string[]>(() => [...parties.value, 'inne'])
  const companies = computed(() => {
    return Array.from(new Set(people.value.map(value => value.employment?.company)));
  })
  const { koryciarz, tuczyciel } = useFeminatyw();

  const dialog = shallowRef(false);

  const formData = vueRef({
    person: '',
    politician: '',
    source: '',
    party: null,
    company: null,
  });

  const saveSuggestion = () => {
    const suggestionsRef = dbRef(db, 'suggestions');
    push(suggestionsRef, {
      ...formData.value,
      date: Date.now(),
      user: user.value?.uid,
    });
    dialog.value = false;
      // Optionally, reset form data: formData.value = { person: '', politician: '', source: '', party: null, company: null };
  };
</script>

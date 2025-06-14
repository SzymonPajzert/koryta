<template>
  <v-dialog
    v-model="dialog"
    max-width="600"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <v-btn
        text="Dodaj"
        v-bind="activatorProps"
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
              label="Koryciarz"
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
              hint="Bliska koryciarzowi osoba polityczna"
              label="Tuczyciel"
              required
            ></v-text-field>
          </v-col>

          <v-col
            cols="12"
            md="8"
            sm="12"
          >
            <v-text-field
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
              :items="['0-17', '18-29', '30-54', '54+']"
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
              :items="['Skiing', 'Ice hockey', 'Soccer', 'Basketball', 'Hockey', 'Reading', 'Writing', 'Coding', 'Basejump']"
              label="Miejsce zatrudnienia"
              auto-select-first
              multiple
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
          @click="dialog = false"
        ></v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
  import { shallowRef } from 'vue'
  const dialog = shallowRef(false)
</script>

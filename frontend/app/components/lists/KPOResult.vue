<template>
  <v-col cols="12" md="6">
    <v-card
      variant="tonal"
      :color="submission.admin?.approved ? undefined : 'yellow'"
      bg-color="white"
      height="100%"
      max-width="450px"
      class="ma-2"
    >
      <v-card-title class="font-weight-bold list-title breakable">{{
        submission.admin?.title ?? "TODO"
      }}
      <v-btn
        icon="mdi-open-in-new"
        :href="
          'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/' +
          submission.id
        "
        target="_blank"
      />
      </v-card-title>
      <v-card-subtitle class="breakable"
        >{{ submission.title }}
      </v-card-subtitle>
      <div class="ma-3">
        {{ submission.content }}
      </div>
      <template v-if="isAdmin">
        <v-divider class="ma-2" thickness="3" />
        <v-row class="ma-3">
          <v-col cols="12">
            {{ submission.score }}
          </v-col>
          <v-col cols="12">
            <v-checkbox
              v-model="admin.approved"
              :value="admin.approved"
              label="Akceptacja"
              indeterminate
            />
          </v-col>
          <v-col cols="12">
            <v-text-field v-model="admin.title" label="Krótki tytuł" />
          </v-col>
          <v-col cols="12">
            <MultiTextField
              v-model="admin.connected"
              title="Wspomniane osoby"
              field-type="entityPicker"
              :field-component="EntityPicker"
              entity="employed"
              hint="np. polityk Adam"
              add-item-tooltip="Dodaj kolejną osobę"
              remove-item-tooltip="Usuń osobę"
              :empty-value="() => emptyEntityPicker('employed')"
            />
          </v-col>
          <v-btn color="primary" @click.stop="submit">Zapisz</v-btn>
        </v-row>
      </template>
    </v-card>
  </v-col>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
import type { KPOSubmission } from "~~/shared/model";
import { ref as dbRef, set } from "firebase/database";
import MultiTextField from "../forms/MultiTextField.vue";
import { EntityPicker } from "#components";

const { submission } = defineProps<{
  submission: KPOSubmission;
}>();
const { isAdmin } = useAuthState();
const db = useDatabase();

const admin = ref<KPOSubmission["admin"]>((() => {
  const result = submission.admin ?? { title: "", connected: {} }
  if (!result.connected) {
    result.connected = {}
  }
  return result;
})());

function submit() {
  console.log(admin.value);
  set(dbRef(db, `admin/kpo/${submission.id}`), admin.value);
}
</script>

<style scoped>
.breakable {
  word-break: break-word;
  white-space: normal;
}

.list-title {
  color: #2e7225;
}
</style>

<template>
  <v-row dense>
    <v-col cols="12" md="8">
      <v-text-field
        v-model="formData.name"
        :label="`Imię i nazwisko ${koryciarz.singular.genitive}`"
        hint="Osoba zatrudniona w publicznej firmie"
        autocomplete="off"
        required
      ></v-text-field>
    </v-col>

    <v-col cols="12" md="4" sm="6">
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

    <MultiTextField
      title="Zatrudnienie"
      v-model="formData.employments"
      field-type="nestedConnection"
      :field-component="NestedConnectionField"
      entity="company"
      hint="np. Członek rady nadzorczej XYZ sp. z o.o."
      add-item-tooltip="Dodaj kolejne zatrudnienie"
      remove-item-tooltip="Usuń zatrudnienie"
      :empty-value="emptyNestedConnection"
    />
    <MultiTextField
      title="Koneksja"
      v-model="formData.connections"
      field-type="nestedConnection"
      :field-component="NestedConnectionField"
      entity="employed"
      hint="np. Znajomy ministra"
      add-item-tooltip="Dodaj kolejną koneksję"
      remove-item-tooltip="Usuń koneksję"
      :empty-value="emptyNestedConnection"
    />
    <MultiTextField
      title="Inna uwaga"
      v-model="formData.comments"
      field-type="textarea"
      :field-component="TextableWrap"
      hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
      add-item-tooltip="Dodaj kolejną uwagę"
      remove-item-tooltip="Usuń uwagę"
      :empty-value="emptyTextable"
    />

    <v-list>
      <!-- TODO turn into an entity picker -->
      <v-list-item class="mb-2" @click="dialogStore.open({ type: 'data' })">
        <v-list-item-title>
          Dodaj źródło
        </v-list-item-title>
      </v-list-item>
      <ArticleBacklink :article="source" :articleID="id" dense v-for="(source, id) in articles" width="100%" />
    </v-list>
  </v-row>
</template>

<script lang="ts" setup>
import { useFeminatyw } from "@/composables/feminatyw";
import { usePartyStatistics } from "@/composables/party";
import type { NepoEmployment } from "@/composables/model";
import { VTextField } from "vuetify/components";
import { computed } from "vue";
import MultiTextField from "@/components/forms/MultiTextField.vue";
import NestedConnectionField from "@/components/forms/NestedConnectionField.vue";
import { emptyTextable, emptyNestedConnection } from "@/composables/multiTextHelper";
import TextableWrap from "../forms/TextableWrap.vue";
import { useArticles } from "@/composables/entities/articles";
import { useDialogStore } from "@/stores/dialog";

const dialogStore = useDialogStore();

const formData = defineModel<NepoEmployment>({required: true});
const { id } = defineProps<{ id?: string }>();

const { parties } = usePartyStatistics();
const partiesDefault = computed<string[]>(() => [...parties.value, "inne"]);
const { koryciarz } = useFeminatyw();
const { userArticles } = useArticles()
const articles = computed(() => {
  if (!id) return {}
  return userArticles.value[id]
})
</script>

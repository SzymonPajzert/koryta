<template>
  <v-row dense>
    <v-col cols="12" md="8">
      <AlreadyExisting
        v-model="formData.name"
        entity="employed"
        :create="create"
        :label="`Imię i nazwisko ${koryciarz.singular.genitive}`"
        hint="Osoba zatrudniona w publicznej firmie"
        autocomplete="off"
        required
      />
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

    <v-expansion-panels>
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
    </v-expansion-panels>

    <v-col cols="12">
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
    </v-col>

    <BacklinksList :id="id" :todo-consumer="addCreatedTodo" />
  </v-row>
</template>

<script lang="ts" setup>
import { useFeminatyw } from "@/composables/feminatyw";
import { usePartyStatistics } from "@/composables/party";
import { Link, type NepoEmployment } from "@/composables/model";
import { computed } from "vue";
import MultiTextField from "@/components/forms/MultiTextField.vue";
import NestedConnectionField from "@/components/forms/NestedConnectionField.vue";
import {
  emptyTextable,
  emptyNestedConnection,
} from "@/composables/multiTextHelper";
import TextableWrap from "../forms/TextableWrap.vue";
import type { Callback } from "@/stores/dialog";

const formData = defineModel<NepoEmployment>({ required: true });
const { id, create } = defineProps<{ id?: string; create?: boolean }>();

const addCreatedTodo: Callback = (name, key) => {
  if (!key) {
    console.warn("failed to obtain key for new entity: ", name);
    // TODO log on the server all console.warns and higher
    return;
  }
  formData.value.todos[key] = new Link<"todo">("todo", key, name);
};

const { parties } = usePartyStatistics();
const partiesDefault = computed<string[]>(() => [...parties.value, "inne"]);
const { koryciarz } = useFeminatyw();
</script>

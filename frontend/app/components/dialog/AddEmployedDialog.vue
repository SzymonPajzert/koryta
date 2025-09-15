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
      />
    </v-col>

    <MultiTextField
      v-slot="itemProps"
      title="Zatrudnienie"
      edge-type="employed"
      :source-id="id"
    >
      <NestedConnectionField
        v-model="itemProps.value"
        entity="company"
        hint="np. Członek rady nadzorczej XYZ sp. z o.o."
      />
    </MultiTextField>

    <MultiTextField
      v-slot="itemProps"
      title="Koneksja"
      edge-type="connection"
      :source-id="id"
    >
      <NestedConnectionField
        v-model="itemProps.value"
        entity="employed"
        hint="np. Znajomy ministra"
      />
    </MultiTextField>

    <MultiTextField
      v-slot="itemProps"
      title="Inna uwaga"
      edge-type="comment"
      :source-id="id"
    >
      <VTextarea
        v-model="itemProps.value.text"
        auto-grow
        rows="2"
        hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
      />
    </MultiTextField>

    <!-- TODO Reenable <BacklinksList :id="id" /> -->
  </v-row>
</template>

<script lang="ts" setup>
import { useFeminatyw } from "@/composables/feminatyw";
import { usePartyStatistics } from "@/composables/party";
import type { Person } from "~~/shared/model";
import { computed } from "vue";
import NestedConnectionField from "@/components/forms/NestedConnectionField.vue";

const formData = defineModel<Person>({ required: true });
const { id, create } = defineProps<{
  id: string;
  create?: boolean;
}>();

const { parties } = usePartyStatistics();
const partiesDefault = computed<string[]>(() => [...parties.value, "inne"]);
const { koryciarz } = useFeminatyw();
</script>

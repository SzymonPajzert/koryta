<template>
  <v-card width="100%" class="ma-4">
    <template #text>
      <v-text-field
        v-model="search"
        label="Search"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        hide-details
        single-line
      />
    </template>
    <v-data-table
      density="compact"
      :headers="headers"
      :items="companies"
      :search="search"
    >
      <!-- eslint fails to pick up the dynamically created slots here -->
      <!-- eslint-disable vue/v-slot-style vue/valid-v-slot -->
      <template v-slot:item.entityID="{ value, item }">
        <entity-picker
          v-if="item.krsNumber && editConnectionKRSNumber == item.krsNumber"
          v-model="editConnectionValue"
          entity="company"
          @update:model-value="editConnection.submit"
          @keydown.escape="editConnection.stop"
        />
        <v-chip
          v-else
          :text="value ? 'Tak' : 'Dodaj powiązanie'"
          :color="goodStatus(value)"
          size="x-small"
          :disabled="!item.krsNumber"
          @click="editConnection.start(item.krsNumber!, value!)"
        />
      </template>

      <template v-slot:item.krsNumber="{ value, item }">
        <v-text-field
          v-if="item.entityID && editKRSCompanyKey == item.entityID"
          v-model="editKRSValue"
          density="compact"
          clearable
          width="160"
          :hide-details="true"
          @keydown.escape="editKRS.stop"
          @keydown.enter="editKRS.submit"
        />
        <v-chip
          v-else
          :text="value ?? 'Dodaj KRS'"
          size="x-small"
          :disabled="!item.entityID || !!value"
          @click="editKRS.start(item.entityID!, value!)"
        />
      </template>

      <template v-slot:item.importedFromRejestr="{ value, item }">
        <v-chip
          :border="`${goodStatus(value)} thin opacity-25`"
          :color="goodStatus(value)"
          :text="value ? 'Tak' : item.krsNumber ? 'Zobacz' : 'Brak'"
          size="x-small"
          :href="
            item.krsNumber
              ? `https://rejestr.io/krs/${item.krsNumber}`
              : undefined
          "
          target="_blank"
        />
      </template>
    </v-data-table>
  </v-card>
</template>

<script lang="ts" setup>
import type { VDataTable } from "vuetify/components";
import type { Company, Link } from "~~/shared/model";
import { useEditIndexedField } from "~/composables/editIndexedField";

definePageMeta({
  middleware: "admin",
});

interface CompanyScoredEditable {
  // DB name takes precedence
  name: string;

  // From rejestr.io and its derivatives
  krsNumber?: string;
  score?: string;
  importedFromRejestr: boolean;
  entityID?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toNumber = (v: any) => Number(v) || 0;

const { entities } = await useEntity("place");

// TODO: Scores logic seems to be missing source
const scores = ref<Record<string, { name: string; score: string | number }>>(
  {},
);

const search = ref("");

const COMPANY_FIELD: keyof Company = "krsNumber" as const;
function setKRSOperation(
  entityKey: string,
  krsNumber: string,
): [string, string] {
  return [`company/${entityKey}/${COMPANY_FIELD}`, krsNumber];
}

// We use those two composables to manage the state and submission to RTDB.
// We make sure that the refs are unwrapped and can be used in the template.
const editKRS = useEditIndexedField(
  (krsNumber: CompanyScoredEditable["krsNumber"]) => krsNumber,
  (entityKey, value) => setKRSOperation(entityKey, value!),
);
const { key: editKRSCompanyKey, value: editKRSValue } = editKRS;

const editConnection = useEditIndexedField<Link<"place">, Link<"place">>(
  (linked) => linked,
  (krsNumber, linked) => setKRSOperation(linked.id, krsNumber!),
);
const { key: editConnectionKRSNumber, value: editConnectionValue } =
  editConnection;

type ReadonlyHeaders = VDataTable["$props"]["headers"];
const headers: ReadonlyHeaders = [
  { title: "Nazwa", value: "name", sortable: true, minWidth: "80%" },
  { title: "Wynik", value: "score", sortable: true },
  // TODO { title: "Publiczna", value: "isPublic", sortable: true },
  { title: "Na stronie", value: "entityID", sortable: true },
  { title: "KRS", value: "krsNumber", sortable: true },
  { title: "Rejestr.io", value: "importedFromRejestr", sortable: true },
] as const;

const companies = computed(() => {
  const mapped = new Map<string, CompanyScoredEditable>();

  Object.entries(scores.value).forEach(([key, value]) => {
    mapped.set(key, {
      name: value.name,
      krsNumber: key,
      score: toNumber(value.score).toFixed(2),

      // This needs to be set by the website version of the item.
      // TODO make sure you can't set if it's in this version.
      // isPublic: false,
      importedFromRejestr: !!value.score,
    });
  });

  Object.entries(entities.value || {}).forEach(([key, company]) => {
    const fetched = mapped.get(company.krsNumber || "") ?? {};

    mapped.set(key, {
      importedFromRejestr: false,
      krsNumber: company.krsNumber,
      ...fetched,
      name: company.name,
      entityID: key,
    });

    if (company.krsNumber) mapped.delete(company.krsNumber);
  });

  return Array.from(mapped.values());
});

function goodStatus(value: boolean): string {
  return value ? "success" : "warning";
}
</script>

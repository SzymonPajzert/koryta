<template>
  <!--
    TODO wypisz linki w karcie
    TODO support linking the company from this button
  -->

  <v-list-item
    @click="setActive()"
    :variant="activeItem ? 'tonal' : 'flat'"
  >
    <!-- Main two-column content -->
    <v-row align="center">
      <!-- Column 1: Product Info & Comment -->
      <v-col cols="12" sm="7" md="8">
        <div class="font-weight-bold">{{ person.name }}</div>
        <div class="text-body-2">
          {{ person.external_basic.tozsamosc.data_urodzenia }}
          <v-chip
            v-for="company in companies"
            :class="companyColors(company)"
            >{{ company.name }}</v-chip
          >
        </div>
        <!-- Display comment if it exists -->
        <div
          v-for="comment in person.comment"
          class="text-caption text-blue-grey-darken-1 mt-2"
        >
          <v-icon
            size="x-small"
            start
            icon="mdi-comment-quote-outline"
          ></v-icon>
          <em>{{ comment }}</em>
        </div>
        <div
          v-for="link in person.link"
          class="text-caption text-blue-grey-darken-1 mt-2"
        >
          <v-icon size="x-small" start icon="mdi-link-variant-outline"></v-icon>
          <em>{{ link }}</em>
        </div>
      </v-col>

      <v-col cols="12" sm="5" md="4" class="d-flex flex-column align-sm-end">
        <span :class="['stock-status', scoreColor()]">
          {{ person.score ?? 0 }}
        </span>
      </v-col>
    </v-row>

    <!-- Action buttons in the append slot for clean alignment -->
    <template v-slot:append>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-arrow-up-bold"
          variant="text"
          @click="addValue(1)"
          title="Add"
        ></v-btn>
        <v-btn
          size="small"
          icon="mdi-arrow-down-bold"
          variant="text"
          @click="addValue(-1)"
          title="Decrease"
        ></v-btn>
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-magnify"
          variant="text"
          @click="openExploration()"
          title="Add/Edit Comment"
        ></v-btn>
        <v-btn
          size="small"
          icon="mdi-account-question-outline"
          variant="text"
          @click="setValue('unknown')"
          title="Edytuj"
        >
          <v-icon color="warning" v-if="person.status === 'unknown'"></v-icon>
          <v-icon v-else></v-icon>
        </v-btn>
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-comment-plus-outline"
          variant="text"
          @click="toggleEditing('comment')"
          title="Add/Edit Comment"
        ></v-btn>
        <v-btn
          size="small"
          icon="mdi-link-variant-plus"
          variant="text"
          @click="toggleEditing('link')"
          title="Edytuj"
        ></v-btn>
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-office-building-outline"
          variant="text"
          title="Dodaj firmę"
        />
        <v-btn
          size="small"
          icon="mdi-account-outline"
          variant="text"
          @click="toggleEditing('person')"
          title="Edytuj"
        >
          <v-icon color="success" v-if="person.person"></v-icon>
          <v-icon v-else></v-icon>
        </v-btn>
      </div>
    </template>
  </v-list-item>

  <!-- Expansion area for the editing form -->
  <v-expand-transition>
    <div v-if="editingItemId === person.external_basic.id">
      <div class="edit-area pa-4">
        <!-- Comment Form -->
        <div v-if="editingType === 'comment'">
          <v-textarea
            label="Dodaj komentarz"
            v-model="tempComment"
            rows="1"
            auto-grow
            variant="outlined"
            density="compact"
            hide-details
          ></v-textarea>
        </div>
        <div v-if="editingType === 'link'">
          <v-text-field
            label="Dodaj link"
            v-model="tempLink"
            variant="outlined"
            density="compact"
            hide-details
          ></v-text-field>
        </div>
        <EntityPicker
          v-if="editingType === 'person'"
          label="Połącz z osobą"
          entity="employed"
          v-model="pickedPerson"
        />

        <div class="d-flex justify-end mt-3">
          <v-btn size="small" variant="text" @click="cancelEdit">Anuluj</v-btn>
          <v-btn size="small" color="primary" flat @click="saveEdit"
            >Dodaj</v-btn
          >
        </div>
      </div>
    </div>
  </v-expand-transition>
  <v-divider />
</template>

<script setup lang="ts">
import { Link, type PersonRejestr } from "@/composables/model";
import { set, ref as dbRef, push } from "firebase/database";
import EntityPicker from "@/components/forms/EntityPicker.vue";
import type { CompanyMembership } from "@/composables/entities/companyScore";

const db = useDatabase();

const { person } = defineProps<{
  person: PersonRejestr;
  companies: CompanyMembership[];
}>();

type EditType = "comment" | "link" | "person";

const editingItemId = ref<string | null>(null);
const editingType = ref<EditType | null>(null);
const activeItem = ref<boolean>(false);

const tempComment = ref<string>();
const tempLink = ref<string>();
const pickedPerson = ref<Link<"employed"> | undefined>();

function setActive() {
  activeItem.value = !activeItem.value;
}

function toggleEditing(editType: EditType) {
  if (
    editingItemId.value === person.external_basic.id &&
    editingType.value === editType
  ) {
    cancelEdit();
    return;
  }
  editingItemId.value = person.external_basic.id;
  editingType.value = editType;
}
function openExploration() {
  activeItem.value = true;
  // TODO link the most important places and open them as well
  // TODO can I go to the news page straight away
  /*
  TODO wyszukaj tez bez srodkowego imienia
  TODO: Wyszukaj w google nazwisko bez drugiego imienia
  TODO: Wyszukaj osobę + nazwa firmy
  TODO Wyszukaj osobę + ich miasta
  TODO rejestr io zawsze na końcu, bo jest dobre do wyszukiwania i szacowania osoby
  */
  window.open("https://www.google.com/search?q=" + person.name, "_blank");
  window.open(
    "https://www.google.com/search?q=" + person.name + " pkw",
    "_blank",
  );
  window.open("https://rejestr.io/osoby/" + person.external_basic.id, "_blank");
}
function cancelEdit() {
  tempComment.value = undefined;
  tempLink.value = undefined;
  pickedPerson.value = undefined;
  editingItemId.value = null;
  editingType.value = null;
}
function saveEdit() {
  if (editingType.value === "comment") {
    push(
      dbRef(db, `external/rejestr-io/person/${editingItemId.value}/comment`),
      tempComment.value,
    );
  } else if (editingType.value === "link") {
    push(
      dbRef(db, `external/rejestr-io/person/${editingItemId.value}/link`),
      tempLink.value,
    );
  } else if (editingType.value === "person") {
    set(
      dbRef(db, `external/rejestr-io/person/${editingItemId.value}/person`),
      pickedPerson.value,
    );
  }
  cancelEdit();
}

function scoreColor() {
  const score = person.score ?? 0;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}
function companyColors(company: CompanyMembership) {
  if (company.state !== "aktualne") return "bg-gray";

  let good = "bg-green";
  if (company.score.score === "start") good += "-darken-1";
  else if (company.score.score < 0) good += "-darken-2";
  else if (company.score.score > 0) good += "-lighten-2";
  return good;
}

function setValue(value: PersonRejestr["status"]) {
  person.status = value;
  set(
    dbRef(db, `external/rejestr-io/person/${person.external_basic.id}/status`),
    value,
  );
}

function addValue(value: number) {
  person.score = (person.score ?? 0) + value;
  set(
    dbRef(db, `external/rejestr-io/person/${person.external_basic.id}/score`),
    person.score,
  );
}
</script>

<style scoped>
.stock-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
}
.positive {
  background-color: #dcfce7; /* Green tint */
  color: #166534; /* Dark Green */
}
.neutral {
  background-color: #ffedd5; /* Orange tint */
  color: #9a3412; /* Dark Orange */
}
.negative {
  background-color: #fee2e2; /* Red tint */
  color: #991b1b; /* Dark Red */
}
</style>

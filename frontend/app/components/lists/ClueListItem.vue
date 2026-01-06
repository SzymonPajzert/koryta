<template>
  <v-list-item :variant="activeItem ? 'tonal' : 'flat'" @click="setActive()">
    <v-row align="center">
      <v-col cols="12" sm="7" md="8">
        <div class="font-weight-bold">{{ person.name }}</div>
        <div class="text-body-2">
          {{ person.external_basic.tozsamosc.data_urodzenia }}
          <v-chip
            v-for="company in companies"
            :key="company.id"
            :class="companyColors(company)"
            >{{ company.name }}</v-chip
          >
        </div>
        <div
          v-for="comment in person.comment"
          :key="comment"
          class="text-caption text-blue-grey-darken-1 mt-2"
        >
          <v-icon size="x-small" start icon="mdi-comment-quote-outline" />
          <em>{{ comment }}</em>
        </div>
        <div
          v-for="link in person.link"
          :key="link"
          class="text-caption text-blue-grey-darken-1 mt-2"
        >
          <v-icon size="x-small" start icon="mdi-link-variant-outline" />
          <em>{{ link }}</em>
        </div>
      </v-col>

      <v-col cols="12" sm="5" md="4" class="d-flex flex-column align-sm-end">
        <span :class="['stock-status', scoreColor()]">
          {{ person.score ?? 0 }}
        </span>
      </v-col>
    </v-row>

    <template #append>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          title="Add"
          size="small"
          icon="mdi-arrow-up-bold"
          variant="text"
          @click="addValue(1)"
        />
        <v-btn
          title="Decrease"
          size="small"
          icon="mdi-arrow-down-bold"
          variant="text"
          @click="addValue(-1)"
        />
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          title="Add/Edit Comment"
          size="small"
          icon="mdi-magnify"
          variant="text"
          @click="openExploration()"
        />
        <v-btn
          title="Edytuj"
          size="small"
          icon="mdi-account-question-outline"
          variant="text"
          @click="setValue('unknown')"
        >
          <v-icon v-if="person.status === 'unknown'" color="warning" />
          <v-icon v-else />
        </v-btn>
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          title="Add/Edit Comment"
          size="small"
          icon="mdi-comment-plus-outline"
          variant="text"
          @click="toggleEditing('comment')"
        />
        <v-btn
          title="Edytuj"
          size="small"
          icon="mdi-link-variant-plus"
          variant="text"
          @click="toggleEditing('link')"
        />
      </div>
      <div class="d-flex flex-sm-column ga-1">
        <v-btn
          size="small"
          icon="mdi-office-building-outline"
          variant="text"
          title="Dodaj firmę"
        />
        <v-btn
          title="Edytuj"
          size="small"
          icon="mdi-account-outline"
          variant="text"
          @click="toggleEditing('person')"
        >
          <v-icon v-if="person.person" color="success" />
          <v-icon v-else />
        </v-btn>
      </div>
    </template>
  </v-list-item>

  <v-expand-transition>
    <div v-if="editingItemId === person.external_basic.id">
      <div class="edit-area pa-4">
        <div v-if="editingType === 'comment'">
          <v-textarea
            v-model="tempComment"
            label="Dodaj komentarz"
            rows="1"
            auto-grow
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>
        <div v-if="editingType === 'link'">
          <v-text-field
            v-model="tempLink"
            label="Dodaj link"
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>
        <FormEntityPicker
          v-if="editingType === 'person'"
          v-model="pickedPerson"
          label="Połącz z osobą"
          entity="person"
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
import type { Link } from "~~/shared/model";
type EditType = "comment" | "link" | "person";

interface CompanyMembership {
  id: string;
  name: string;
  state: string;
  score: {
    score: number | string;
  };
}

interface CluePerson {
  name: string;
  id: string;
  rejestr_io_id: string; // vs rejestrIo
  score: number;
  external_basic: {
    tozsamosc: { data_urodzenia: string };
    id: string; // used in v-if
  };
  comment: string[];
  link: string[];
  status: string; // 'unknown' etc.
  person: boolean | object; // used in v-if="person.person"
}

const editingItemId = ref<string | null>(null);
const editingType = ref<EditType | null>(null);
const activeItem = ref<boolean>(false);

const person = ref<CluePerson>({
  name: "",
  id: "",
  rejestr_io_id: "",
  score: 0,
  external_basic: {
    tozsamosc: { data_urodzenia: "" },
    id: "",
  },
  comment: [],
  link: [],
  status: "",
  person: false,
});
const tempComment = ref<string>();
const tempLink = ref<string>();
const pickedPerson = ref<Link<"person"> | undefined>();
const companies: CompanyMembership[] = [];

function setActive() {
  activeItem.value = !activeItem.value;
}

function toggleEditing(editType: EditType) {
  if (
    editingItemId.value === person.value.id &&
    editingType.value === editType
  ) {
    cancelEdit();
    return;
  }
  editingItemId.value = person.value.id;
  editingType.value = editType;
}
function openExploration() {
  activeItem.value = true;

  window.open("https://www.google.com/search?q=" + person.value.name, "_blank");
  window.open(
    "https://www.google.com/search?q=" + person.value.name + " pkw",
    "_blank",
  );
  companies.forEach((company) => {
    window.open(
      "https://www.google.com/search?q=" +
        `${person.value.name} ${company.name}`,
      "_blank",
    );
  });
  window.open(
    "https://www.google.com/search?q=" + person.value.name + " pkw",
    "_blank",
  );
  // rejestr.io is always last, so we can check out the person's history easily
  window.open(
    "https://rejestr.io/osoby/" + person.value.rejestr_io_id,
    "_blank",
  );
}
function cancelEdit() {
  tempComment.value = undefined;
  tempLink.value = undefined;
  pickedPerson.value = undefined;
  editingItemId.value = null;
  editingType.value = null;
}
function saveEdit() {
  // TODO save comment
  // TODO save link
  // TODO save person association
  cancelEdit();
}

function scoreColor() {
  const score = person.value.score ?? 0;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}
function companyColors(company: CompanyMembership) {
  if (company.state !== "aktualne") return "bg-gray";

  let good = "bg-green";
  if (company.score.score === "start") good += "-darken-1";
  else if (Number(company.score.score) < 0) good += "-darken-2";
  else if (Number(company.score.score) > 0) good += "-lighten-2";
  return good;
}

function setValue(_value: unknown) {
  // TODO I'm not sure what
  // external/rejestr-io/person/${person.external_basic.id}/status was
}

function addValue(value: number) {
  person.value.score = (person.value.score ?? 0) + value;
  // TODO set it in DB as well
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

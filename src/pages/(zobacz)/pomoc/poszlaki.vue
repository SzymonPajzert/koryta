<template>
  <!-- <v-card>
    TODO wypisz linki
    TODO wyszukaj tez bez srodkowego imienia
    TODO List active companies that the person is a part of, filter on them
    TODO: Yellow if person is suggested (because in DB) and put on to
  </v-card> -->

  <v-card width="100%" align="center" class="mt-3">
    <v-card-title>
      Znalazłem {{ Object.keys(peopleOrdered).length }} osób
    </v-card-title>
    <v-card-text>
      {{ visited }} przejrzanych
      <br/>
      {{ toAdd }} do dodania
      <br/>
      {{ toCheck }} do sprawdzenia

    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn @click="sortKeys">Sortuj</v-btn>
    </v-card-actions>
  </v-card>

  <v-divider />

  <v-list lines="two" width="100%">
    <template v-for="[index, person] in peopleOrdered" :key="index">
      <v-list-item
        v-if="person.external_basic.state == 'aktualne'"
        @click="setActive(index)"
        :variant="index === activeItem ? 'tonal' : 'flat'"
        >
        <!-- Main two-column content -->
        <v-row align="center">
          <!-- Column 1: Product Info & Comment -->
          <v-col cols="12" sm="7" md="8">
            <div class="font-weight-bold">{{ person.name }}</div>
            <div class="text-body-2">
              {{ person.external_basic.tozsamosc.data_urodzenia }}
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
              <v-icon
                size="x-small"
                start
                icon="mdi-link-variant-outline"
              ></v-icon>
              <em>{{ link }}</em>
            </div>
          </v-col>

          <!-- Column 2: Price and Stock Status -->
          <v-col
            cols="12"
            sm="5"
            md="4"
            class="d-flex flex-column align-sm-end"
          >
            <span :class="['stock-status', scoreColor(person)]">
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
              @click="addValue(person, 1)"
              title="Add"
            ></v-btn>
            <v-btn
              size="small"
              icon="mdi-arrow-down-bold"
              variant="text"
              @click="addValue(person, -1)"
              title="Decrease"
            ></v-btn>
          </div>
          <div class="d-flex flex-sm-column ga-1">
            <v-btn
              size="small"
              icon="mdi-magnify"
              variant="text"
              @click="openExploration(person)"
              title="Add/Edit Comment"
            ></v-btn>
            <v-btn
              size="small"
              icon="mdi-account-outline"
              variant="text"
              @click="toggleEditing(person, 'person')"
              title="Edytuj"
            >
              <v-icon color="success" v-if="person.person"></v-icon>
              <v-icon v-else></v-icon>
            </v-btn>
          </div>
          <div class="d-flex flex-sm-column ga-1">
            <v-btn
              size="small"
              icon="mdi-comment-plus-outline"
              variant="text"
              @click="toggleEditing(person, 'comment')"
              title="Add/Edit Comment"
            ></v-btn>
            <v-btn
              size="small"
              icon="mdi-link-variant-plus"
              variant="text"
              @click="toggleEditing(person, 'link')"
              title="Edytuj"
            ></v-btn>
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
              <v-btn size="small" variant="text" @click="cancelEdit"
                >Anuluj</v-btn
              >
              <v-btn size="small" color="primary" flat @click="saveEdit"
                >Dodaj</v-btn
              >
            </div>
          </div>
        </div>
      </v-expand-transition>
      <v-divider />
    </template>
  </v-list>
</template>

<script setup lang="ts">
import { Link, type PersonRejestr } from "@/composables/model";
import { createEntityStore } from "@/stores/entity";
import { set, ref as dbRef, push } from "firebase/database";
import { db } from "@/firebase";
import EntityPicker from "@/components/forms/EntityPicker.vue";

const usePeopleStore = createEntityStore("external/rejestr-io/person");
const peopleStore = usePeopleStore();
const { entities: people } = storeToRefs(peopleStore);

const peopleFiltered = computed(() => {
  return Object.fromEntries(
    Object.entries(people.value).filter(
      ([key, person]: [string, PersonRejestr]) => {
        // TODO support filtering per KRS stattus, now it's just the last used value and it's very brittle
        return (
          person &&
          person.external_basic &&
          person.external_basic.state == "aktualne"
        );
      },
    ),
  );
});

const keys = ref<string[]>([]);
watch(peopleFiltered, (value, oldValue) => {
  const newKeys = Object.keys(value);
  const oldKeys = Object.keys(oldValue);
  if (newKeys.length === oldKeys.length) {
    return;
  }
  keys.value = Object.keys(value);
});
const sortKeys = function () {
  keys.value.sort(
    (a, b) =>
      peopleFiltered.value[b].score ?? 0 - (peopleFiltered.value[a].score ?? 0),
  );
};

const peopleOrdered = computed<[string, PersonRejestr][]>(() => {
  const filtered = peopleFiltered.value;
  return keys.value.map((key) => [key, filtered[key]]);
});

const visited = computed(() => Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) != 0).length)
const toAdd = computed(() => Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) > 0).length)
const toCheck = computed(() => Object.values(peopleOrdered.value).filter(([_, p]) => (p.score ?? 0) == 0).length)

type EditType = "comment" | "link" | "person";
const editingItemId = ref<string | null>(null);
const editingType = ref<EditType | null>(null);
const activeItem = ref<string | null>(null);

const tempComment = ref<string>();
const tempLink = ref<string>();
const pickedPerson = ref<Link<"employed"> | undefined>();

function setActive(index: string) {
  if (activeItem.value === index) {
    activeItem.value = null
  } else {
    activeItem.value = index;
  }
}

function toggleEditing(person: PersonRejestr, editType: EditType) {
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
function openExploration(person: PersonRejestr) {
  activeItem.value = person.external_basic.id;
  // TODO link the most important places and open them as well
  // TODO can I go to the news page straight away
  window.open("https://www.google.com/search?q=" + person.name, "_blank");
  window.open("https://www.google.com/search?q=" + person.name + " pkw", "_blank");
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

function scoreColor(person: PersonRejestr) {
  const score = person.score ?? 0;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}
function addValue(person: PersonRejestr, value: number) {
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

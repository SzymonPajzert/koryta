<template>
  <div style="display: contents">
    <slot name="activator" :props="{ onClick: openDialog }">
      <ButtonProposeChange
        data-testid="region-propose-change"
        @click="openDialog"
      />
    </slot>

    <!-- A region's „Władze”, the one thing about a region anybody may
         propose: its name and its code come from the TERYT register. A tab
         for the head and one for each council, so a change to the burmistrz
         is not filed under sixty names. Szymon, 2026-11-18: "volunteers can
         change this information themselves". -->
    <v-dialog v-model="dialog" max-width="720" scrollable>
      <v-card data-testid="region-government-dialog">
        <v-card-title>Zaproponuj zmianę</v-card-title>
        <v-card-subtitle class="pb-2">
          {{ sections?.title }}
          <template v-if="sections?.term">
            · kadencja {{ sections.term }}</template
          >
        </v-card-subtitle>

        <!-- The parts as the site's segmented control: Vuetify's tab bar
             lost its place when a long council's tab opened in the
             scrolling dialog. -->
        <div class="px-4 pb-3">
          <SegmentedToggle v-model="tab" data-testid="region-government-parts">
            <v-btn
              v-for="part in parts"
              :key="part.key"
              :value="part.key"
              :data-testid="`region-government-tab-${part.key}`"
            >
              {{ part.title }}
            </v-btn>
          </SegmentedToggle>
        </div>
        <v-divider />

        <v-card-text>
          <p class="mb-4">Zmiany zatwierdzamy przed publikacją.</p>

          <v-window v-model="tab">
            <!-- The head: who, their page, their committee, since when. -->
            <v-window-item v-if="draft.head" value="head">
              <v-text-field
                v-model="draft.head.name"
                label="Imię i nazwisko"
                data-testid="region-government-head-name"
              />
              <FormEntityPicker
                v-model="draft.head.page"
                entity="person"
                label="Strona na koryta.pl (opcjonalnie)"
                clearable
              />
              <v-text-field
                v-model="draft.head.committee"
                label="Komitet (opcjonalnie)"
              />
              <v-text-field
                v-model="draft.head.since"
                label="Od kiedy (opcjonalnie)"
                hint="RRRR-MM-DD"
                persistent-hint
              />
            </v-window-item>

            <!-- A council: a row each, name and committee. -->
            <v-window-item
              v-for="(council, index) in draft.councils"
              :key="council.office"
              :value="`rada-${index}`"
            >
              <div
                v-for="(member, row) in council.members"
                :key="member.key"
                class="council-row"
                :data-testid="`region-government-member-${index}-${row}`"
              >
                <v-text-field
                  v-model="member.name"
                  label="Imię i nazwisko"
                  density="compact"
                  hide-details
                />
                <v-combobox
                  v-model="member.committee"
                  :items="committeesOf(council)"
                  label="Komitet"
                  density="compact"
                  hide-details
                />
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  :aria-label="`Usuń: ${member.name || 'pusty wiersz'}`"
                  @click="council.members.splice(row, 1)"
                >
                  <v-icon :icon="mdiClose" />
                </v-btn>
              </div>
              <v-btn
                variant="text"
                :prepend-icon="mdiPlus"
                class="px-2 ms-n2 mt-2"
                data-testid="region-government-add-member"
                @click="addMember(council)"
              >
                Dodaj osobę
              </v-btn>
            </v-window-item>
          </v-window>

          <v-alert v-if="error" type="error" class="mt-2">{{ error }}</v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Anuluj</v-btn>
          <!-- A sage fill with dark text: sage is a fill, never text
               (system.md, 2026-10-14). -->
          <v-btn
            color="primary"
            variant="flat"
            :loading="loading"
            data-testid="region-government-submit"
            @click="submit"
          >
            Zaproponuj
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <DialogLogin
      v-model="loginDialog"
      hide-activator
      @success="dialog = true"
    />
  </div>
</template>

<script setup lang="ts">
import { mdiClose, mdiPlus } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authRequest } from "~/composables/auth";
import type {
  GovernmentCouncil,
  GovernmentHead,
  GovernmentPerson,
  Link,
  RegionGovernment,
} from "~~/shared/model";
import type {
  GovernmentPersonView,
  GovernmentSections,
  GovernmentView,
} from "~~/shared/regionAuthorities";

const props = defineProps<{
  regionId: string;
  /** The record as the page shows it to this reader: a signed in reader's has
   * every page linked, which is what the proposal states. */
  view: GovernmentView | null;
  /** The page's sections, for the titles and for a head nobody is known for
   * yet - a starosta's slot. */
  sections: GovernmentSections | null;
}>();

const emit = defineEmits<{
  (e: "submitted", id: string, duplicate?: boolean): void;
}>();

const user = useCurrentUser();
const router = useRouter();
const route = useRoute();

const dialog = ref(false);
const loginDialog = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const tab = ref("head");

/** A person on the form: what the record says, editable, and what it said
 * when the form opened - a link and a committee's parties belong to the name
 * and the committee they came with. */
interface DraftPerson {
  key: number;
  name: string;
  page?: Link<"person">;
  committee: string;
  original?: GovernmentPersonView;
}

interface DraftHead extends Omit<DraftPerson, "key"> {
  office: string;
  since: string;
  member?: string;
}

interface DraftCouncil {
  office: string;
  title: string;
  seats?: number;
  members: DraftPerson[];
}

let keys = 0;
const draft = reactive<{ head: DraftHead | null; councils: DraftCouncil[] }>({
  head: null,
  councils: [],
});

function draftPerson(person: GovernmentPersonView): DraftPerson {
  keys += 1;
  return {
    key: keys,
    name: person.name,
    ...(person.page
      ? { page: { type: "person", id: person.page.id, name: person.name } }
      : {}),
    committee: person.committee ?? "",
    original: person,
  };
}

/** The form, from the record as the page shows it. Built each time it opens,
 * so a cancelled edit leaves nothing behind. */
function prefill() {
  const head = props.view?.head;
  const office = head?.office ?? props.sections?.head?.office;
  draft.head = office
    ? {
        ...(head ? draftPerson(head) : { name: "", committee: "" }),
        office,
        since: head?.since ?? "",
        ...(head?.member ? { member: head.member } : {}),
      }
    : null;
  draft.councils = (props.view?.councils ?? []).map((council) => {
    // In the page's order - by committee, the largest first, then by name -
    // so a reader finds a councillor where the page showed them.
    const section = props.sections?.councils.find(
      (each) => each.office === council.office,
    );
    const members = section
      ? section.committees.flatMap((group) => group.members)
      : council.members;
    return {
      office: council.office,
      title: section?.title ?? council.office,
      ...(typeof council.seats === "number" ? { seats: council.seats } : {}),
      members: members.map(draftPerson),
    };
  });
  tab.value = draft.head ? "head" : "rada-0";
  error.value = null;
}

const parts = computed(() => [
  ...(draft.head
    ? [{ key: "head", title: props.sections?.head?.title ?? draft.head.office }]
    : []),
  ...draft.councils.map((council, index) => ({
    key: `rada-${index}`,
    title: council.title,
  })),
]);

function openDialog() {
  prefill();
  if (user.value) dialog.value = true;
  else loginDialog.value = true;
}

function committeesOf(council: DraftCouncil): string[] {
  return [
    ...new Set(
      council.members.flatMap((member) =>
        member.committee ? [member.committee] : [],
      ),
    ),
  ];
}

function addMember(council: DraftCouncil) {
  keys += 1;
  council.members.push({ key: keys, name: "", committee: "" });
}

/** A person as the record stores them. A link stays with the name it came
 * with, and a committee's parties with the committee: a row typed over is
 * somebody else. */
function stored(person: Omit<DraftPerson, "key">): GovernmentPerson {
  const name = person.name.trim();
  const committee = person.committee.trim();
  const original = person.original;
  const sameName = original?.name === name;
  const personId =
    person.page && (person.page.id !== original?.page?.id || sameName)
      ? person.page.id
      : undefined;
  const committeeParties =
    original?.committee === committee ? original.committeeParties : undefined;
  return {
    name,
    ...(personId ? { personId } : {}),
    ...(committee ? { committee } : {}),
    ...(committeeParties?.length ? { committeeParties } : {}),
  };
}

function record(): RegionGovernment {
  const head = draft.head;
  const headName = head?.name.trim() ?? "";
  const stateHead: GovernmentHead | undefined =
    head && headName
      ? {
          ...stored(head),
          office: head.office,
          // PKW's word on the party of the person it named, not of whoever
          // is typed in instead.
          ...(head.member && head.original?.name === headName
            ? { member: head.member }
            : {}),
          ...(head.since.trim() ? { since: head.since.trim() } : {}),
        }
      : undefined;
  const councils: GovernmentCouncil[] = draft.councils.map((council) => {
    const members = council.members
      .filter((member) => member.name.trim())
      .map(stored);
    return {
      office: council.office,
      seats: Math.max(council.seats ?? 0, members.length),
      members,
    };
  });
  return {
    ...(props.view?.election ? { election: props.view.election } : {}),
    ...(stateHead ? { head: stateHead } : {}),
    councils,
  };
}

async function submit() {
  loading.value = true;
  error.value = null;
  try {
    const response = await authRequest<{
      id: string;
      node_id: string;
      duplicate?: boolean;
    }>("/api/revisions/create", {
      method: "POST",
      body: { node_id: props.regionId, authorities: record() },
    });
    dialog.value = false;
    emit("submitted", response.id, response.duplicate === true);
    // The page with the proposal laid over it, as every other edit lands.
    router.push({
      path: route.path,
      query: { ...route.query, revisionId: response.id },
    });
  } catch (e: unknown) {
    const message = (e as { data?: { message?: string } } | null)?.data
      ?.message;
    error.value = message || (e instanceof Error ? e.message : "Wystąpił błąd");
  } finally {
    loading.value = false;
  }
}

defineExpose({ open: openDialog });
</script>

<style scoped>
/* Name, committee and the way to remove the row on one line; on a phone the
   committee goes under the name. */
.council-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  margin-bottom: 8px;
}

@media (max-width: 599.98px) {
  .council-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .council-row > :nth-child(2) {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>

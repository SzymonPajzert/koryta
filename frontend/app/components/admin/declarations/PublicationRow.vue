<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`publikacja-${row.personId}`"
    class="dpub"
    :tone="tone"
    :data-person-id="row.personId"
    :data-publication="row.status"
    data-publication-row
  >
    <template #summary>
      <span class="arow-grow dpub__name">{{ row.name }}</span>
      <span class="arow-tag" :class="toneClasses(tone)" data-publication-tag>
        {{ tag }}
      </span>
      <span class="arow-side text-medium-emphasis dpub__unit">
        {{ row.unit }}
      </span>
      <span class="arow-fixed text-medium-emphasis dpub__at">
        {{ shortWarsawTime(row.at, now) }}
      </span>
    </template>

    <template #meta>
      <AdminRowFact label="Stan">{{ statusLabel }}</AdminRowFact>
      <AdminRowFact label="Strona">
        <span data-page-public>{{
          row.pagePublic ? "publiczna" : "szkic"
        }}</span>
      </AdminRowFact>
      <AdminRowFact :label="row.status === 'held' ? 'Wstrzymane' : 'Kiedy'">
        {{ shortWarsawTime(row.at, now) }}
      </AdminRowFact>
      <AdminRowFact label="Jednostka">{{ row.unit }}</AdminRowFact>
      <AdminRowFact label="Powiązania">{{ edgesText }}</AdminRowFact>
    </template>

    <p v-if="holdNote" class="dpub__reason" data-hold-note>
      {{ holdNote }}
    </p>
    <p v-else-if="row.status === 'queued'" class="dpub__reason">
      Czeka na miejsce w dziennym limicie.
    </p>

    <!-- What a conflicting reading is held for, in place: the list of other
         dates shows only the newest, and these are usually further down it.
         The decisions on them are the same ones. -->
    <p v-if="cropsGone" class="dpub__reason" data-hold-crops-empty>
      Żaden wycinek nie podaje już innej daty. Sprawdź ponownie.
    </p>
    <section
      v-else-if="showCrops"
      class="dpub__crops"
      aria-label="Wycinki z inną datą"
      data-hold-crops
    >
      <h3 class="dpub__subhead">Wycinki z inną datą</h3>
      <v-skeleton-loader v-if="cropsLoading" type="list-item-two-line" />
      <p v-else-if="cropsError" class="dpub__reason" data-hold-crops-error>
        {{ cropsError }}
        <v-btn size="small" variant="text" @click="loadCrops">
          Spróbuj ponownie
        </v-btn>
      </p>
      <AdminRowList v-else-if="crops?.length">
        <AdminDeclarationsReviewRow
          v-for="crop in crops"
          :key="crop.id"
          v-model:expanded="openCrops[crop.id]"
          kind="different"
          :row="crop"
          :now="now"
          :busy="cropBusy?.(crop.id) ?? null"
          @settle="(value: string) => emit('crop', crop, 'settle', value)"
          @unreadable="emit('crop', crop, 'unreadable')"
          @withdraw="emit('crop', crop, 'withdraw')"
        />
      </AdminRowList>
    </section>

    <div class="dpub__links">
      <!-- The one link that is the row's next step, ahead of the two that
           only lead somewhere. -->
      <v-btn
        v-if="actions.publish && row.reason === 'pending_proposal'"
        size="small"
        variant="tonal"
        :to="`/admin/rewizje/${row.personId}`"
        :prepend-icon="mdiFileCompare"
        data-hold-revisions
      >
        Propozycja zmiany
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :to="`/entity/person/${row.personId}`"
        :prepend-icon="mdiAccountOutline"
      >
        Strona osoby
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :href="row.documentUrl"
        target="_blank"
        rel="noopener"
        :prepend-icon="mdiOpenInNew"
      >
        Oświadczenie w BIP
      </v-btn>
    </div>

    <template v-if="hasDecisions" #footer>
      <v-btn
        v-if="actions.publish"
        class="dpub__decision"
        variant="tonal"
        color="ink-success"
        :prepend-icon="mdiCheck"
        :disabled="!!busy"
        data-hold-publish
        @click="emit('publish')"
      >
        Opublikuj ręcznie
      </v-btn>
      <v-btn
        v-if="actions.recheck"
        class="dpub__decision"
        variant="outlined"
        :prepend-icon="row.pagePublic ? mdiClose : mdiRefresh"
        :disabled="!!busy"
        :loading="busy === 'recheck'"
        data-hold-recheck
        @click="emit('recheck')"
      >
        {{ row.pagePublic ? "Zamknij wiersz" : "Sprawdź ponownie" }}
      </v-btn>
      <v-btn
        v-if="actions.restore"
        class="dpub__decision"
        variant="outlined"
        :prepend-icon="mdiUndoVariant"
        :disabled="!!busy"
        :loading="busy === 'restore'"
        data-hold-restore
        @click="emit('restore')"
      >
        Przywróć
      </v-btn>
      <v-btn
        v-if="actions.decline"
        class="dpub__decision dpub__decline"
        variant="text"
        color="ink-danger"
        :prepend-icon="mdiCancel"
        :disabled="!!busy"
        :loading="busy === 'decline'"
        data-hold-decline
        @click="emit('decline')"
      >
        Nie publikuj
      </v-btn>
    </template>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  mdiAccountOutline,
  mdiCancel,
  mdiCheck,
  mdiClose,
  mdiFileCompare,
  mdiOpenInNew,
  mdiRefresh,
  mdiUndoVariant,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import type { RowTone } from "~/composables/rowTone";
import { polishCounting } from "~/composables/polish";
import { toneClasses } from "~/utils/jobStyle";
import {
  declarationHoldActions,
  declarationHoldLabel,
  declarationHoldNote,
  declarationHoldTone,
} from "~/utils/declarationsAdmin";
import {
  publicationSetAside,
  type DeclarationPublicationRow,
  type DeclarationReviewRow,
} from "~~/shared/declarations";
import { shortWarsawTime } from "~~/shared/jobs";

/** A person published from the queue, by the automation or at an admin's
 * press, waiting in it, held, or set aside, as /admin/oswiadczenia lists them.
 *
 * A held one says why in the words of the hold and what would clear it, and
 * its foot holds the decisions: publish it by hand, in the dialog the person's
 * own page opens, which is where two candidacies are told apart; check it again
 * once what held it is gone; or say it will not be published, which is taken
 * back as easily. Held for a crop that reads another day, it shows that crop.
 * Whether the page is public now is on the row too. */
const props = defineProps<{
  row: DeclarationPublicationRow;
  now: Date;
  /** The decision on this row being sent. */
  busy?: "recheck" | "decline" | "restore" | null;
  /** The decision being sent on one of the row's crops. */
  cropBusy?: (id: string) => "settle" | "unreadable" | "withdraw" | null;
}>();

const emit = defineEmits<{
  publish: [];
  recheck: [];
  decline: [];
  restore: [];
  /** A decision on one of the crops the row shows, for the page to send. */
  crop: [
    crop: DeclarationReviewRow,
    decision: "settle" | "unreadable" | "withdraw",
    value?: string,
  ];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const setAside = computed(() => publicationSetAside(props.row));
const actions = computed(() => declarationHoldActions(props.row));
const hasDecisions = computed(() =>
  Object.values(actions.value).some((offered) => offered),
);

const showCrops = computed(
  () =>
    actions.value.recheck &&
    !props.row.pagePublic &&
    props.row.reason === "conflicting_reading",
);
const crops = ref<DeclarationReviewRow[] | null>(null);
const cropsLoading = ref(false);
const cropsError = ref<string | null>(null);
/** The crops open, each by itself; the only one starts open. */
const openCrops = reactive<Record<string, boolean>>({});

/** The last crop is gone, withdrawn most likely, which is what the row asked
 * for: it stops asking, and what is left to do is to check the page again. */
const cropsGone = computed(
  () => showCrops.value && crops.value?.length === 0 && !cropsError.value,
);

const holdNote = computed(() =>
  (props.row.status === "held" || props.row.status === "declined") &&
  !cropsGone.value
    ? declarationHoldNote(props.row)
    : null,
);

async function loadCrops() {
  cropsLoading.value = crops.value === null;
  cropsError.value = null;
  try {
    crops.value = await authRequest<DeclarationReviewRow[]>(
      `/api/declarations/publications/${encodeURIComponent(props.row.personId)}/crops`,
      { method: "GET" },
    );
    const [only, ...others] = crops.value;
    if (only && others.length === 0) openCrops[only.id] ??= true;
  } catch {
    cropsError.value = "Nie udało się wczytać wycinków.";
  } finally {
    cropsLoading.value = false;
  }
}

// On opening, and after the page reloads with a decision on one of them.
watch(
  () => [expanded.value, showCrops.value, props.row] as const,
  ([open, wanted]) => {
    if (open && wanted) loadCrops();
  },
  { immediate: true },
);

const tone = computed<RowTone>(() => {
  if (props.row.status === "published") return "success";
  if (props.row.status === "queued") return "sage";
  if (setAside.value) return "neutral";
  return declarationHoldTone(props.row.reason, props.row.pagePublic);
});

const tag = computed(() => {
  if (props.row.status === "published") return "opublikowana";
  if (props.row.status === "queued") return "w kolejce";
  return declarationHoldLabel(props.row);
});

/** The state in full, for the open row. A page an admin pressed for is the
 * admin's publication, not the automation's. */
const statusLabel = computed(() => {
  if (props.row.status === "published") {
    return props.row.pressed
      ? "opublikowana przez administratora"
      : "opublikowana automatycznie";
  }
  if (props.row.status === "queued") return "w kolejce do publikacji";
  return setAside.value ? "nie do publikacji" : "wstrzymana";
});

/** „12 opublikowanych, 2 wstrzymane” - the relations that went live with the
 * page and the ones that did not. */
const edgesText = computed(() => {
  const { published, held } = props.row.edges;
  const parts = [
    polishCounting(published, "opublikowane", "opublikowane", "opublikowanych"),
  ];
  if (held > 0) {
    parts.push(
      polishCounting(held, "wstrzymane", "wstrzymane", "wstrzymanych"),
    );
  }
  return parts.join(", ");
});
</script>

<style scoped>
.dpub__name {
  font-size: 0.875rem;
  font-weight: 500;
}

.dpub__unit,
.dpub__at {
  font-size: 0.75rem;
}

.dpub__reason {
  margin: 0 0 12px;
  font-size: 0.875rem;
  text-wrap: pretty;
}

.dpub__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dpub__crops {
  margin-bottom: 12px;
}

.dpub__subhead {
  margin: 0 0 8px;
  font-size: 0.8125rem;
  font-weight: 600;
}

.dpub__decision {
  height: 40px;
}

/* The way out sits apart from the ways up, as a crop's „Wycofaj” does. */
.dpub__decline {
  margin-inline-start: auto;
}

/* On a phone the line breaks in two: the name and when on the first, the tag
 * and the unit under them. The empty item ordered between the two halves is
 * what forces the break; without it a short name lets the tag ride up and
 * push the line wider than the screen. */
@media (max-width: 599.98px) {
  .dpub :deep(.arow__toggle) {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  .dpub :deep(.arow__toggle)::after {
    content: "";
    order: 1;
    flex-basis: 100%;
  }

  .dpub [data-publication-tag],
  .dpub__unit {
    order: 2;
  }

  .dpub [data-publication-tag] {
    margin-inline-start: 28px;
  }

  .dpub__unit {
    flex: 1 1 0;
    max-width: none;
  }

  /* One under another, the same width, the way a thumb reaches them. */
  .dpub__decision {
    flex: 1 1 100%;
  }

  .dpub__decline {
    margin-inline-start: 0;
  }
}
</style>

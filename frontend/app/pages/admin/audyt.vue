<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn :icon="mdiArrowLeft" variant="text" class="mr-2" to="/admin" />
      <div>
        <h1 class="text-h5 text-sm-h4">Dziennik decyzji</h1>
        <div class="text-caption text-grey-darken-1">
          Co administratorzy zdecydowali o wpisach i powiązaniach - kto, kiedy,
          czego to dotyczyło i dlaczego. Usunięte powiązania można stąd
          przywrócić.
        </div>
      </div>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
      data-testid="audit-error"
    />

    <v-card class="mb-4 pa-3">
      <div class="d-flex align-center flex-wrap ga-3">
        <v-select
          v-model="action"
          :items="actionItems"
          label="Rodzaj decyzji"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 260px"
          data-testid="audit-action-filter"
          @update:model-value="load()"
        />
        <v-spacer />
        <div class="text-caption text-grey-darken-1">Najnowsze na górze.</div>
      </div>
    </v-card>

    <v-data-table
      density="compact"
      item-value="id"
      :headers="headers"
      :items="rows"
      :loading="pending"
      :no-data-text="noDataText"
      loading-text="Ładowanie..."
      items-per-page="-1"
      data-testid="audit-table"
    >
      <template #[`item.at`]="{ item }">
        <span class="text-caption">{{ formatAt(item.at) }}</span>
      </template>

      <template #[`item.user`]="{ item }">
        <UserChip :uid="item.user" />
      </template>

      <template #[`item.action`]="{ item }">
        <v-chip size="small" label :color="actionColor(item.action)">
          {{ auditActionLabel(item.action, item.collection) }}
        </v-chip>
      </template>

      <template #[`item.target`]="{ item }">
        <div class="d-flex flex-column">
          <nuxt-link
            v-if="item.targetPath"
            :to="item.targetPath"
            class="text-decoration-none text-primary"
          >
            {{ item.targetName || item.target_id }}
          </nuxt-link>
          <span v-else>{{ item.targetName || item.target_id }}</span>
          <span
            v-if="item.targetDetail"
            class="text-caption text-medium-emphasis"
          >
            {{ item.targetDetail }}
          </span>
        </div>
      </template>

      <template #[`item.reason`]="{ item }">
        <span class="text-caption text-wrap">{{ item.reason || "-" }}</span>
      </template>

      <template #[`item.actions`]="{ item }">
        <!-- Flat, not tonal. Tonal draws the label in the theme's pale sage on
             a wash of the same sage, which is 1.73:1 - the combination
             `EntityDetailView` and `card/EmploymentHistory` both call out. Flat
             is black on sage, and this is the one control in the row. -->
        <v-btn
          v-if="item.restorable"
          size="small"
          variant="flat"
          color="primary"
          :prepend-icon="mdiRestore"
          :loading="restoring === item.id"
          :data-testid="`audit-restore-${item.id}`"
          @click="restore(item)"
        >
          Przywróć
        </v-btn>
      </template>

      <template #bottom>
        <div class="d-flex justify-center pa-3">
          <v-btn
            v-if="nextCursor"
            variant="text"
            :loading="pending"
            data-testid="audit-load-more"
            @click="load(true)"
          >
            Wczytaj więcej
          </v-btn>
        </div>
      </template>
    </v-data-table>

    <v-snackbar v-model="noticeShown" color="info" :timeout="8000">
      {{ notice }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { mdiArrowLeft, mdiRestore } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import {
  auditActions,
  auditActionLabel,
  auditActionLabels,
} from "~~/shared/audit";
import type { AuditAction } from "~~/shared/audit";
import type { AuditLog, AuditRow } from "~~/server/api/admin/audit.get";
import type { EdgeRestored } from "~~/server/api/edges/restore.post";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({ title: "Dziennik decyzji (Admin) - koryta.pl" });

const headers = [
  { title: "Kiedy", key: "at", sortable: false, width: 150 },
  { title: "Kto", key: "user", sortable: false, width: 200 },
  { title: "Decyzja", key: "action", sortable: false, width: 190 },
  { title: "Czego dotyczy", key: "target", sortable: false },
  { title: "Powód", key: "reason", sortable: false },
  { title: "", key: "actions", sortable: false, align: "end" as const },
];

const actionItems = auditActions.map((value) => ({
  value,
  title: auditActionLabels[value],
}));

const rows = ref<AuditRow[]>([]);
const nextCursor = ref<string | null>(null);
const action = ref<AuditAction | null>(null);
const pending = ref(false);
const restoring = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const noticeShown = ref(false);

/** An empty page is not always an empty log. The action filter runs in memory
 * over a bounded window, so a rare decision can leave a whole window with
 * nothing in it while there is plenty further back - and "Nic tu jeszcze nie
 * ma." next to a live "Wczytaj więcej" reads as a contradiction. */
const noDataText = computed(() => {
  if (nextCursor.value) {
    return "W tej części dziennika nic nie pasuje - kliknij „Wczytaj więcej”.";
  }
  return action.value
    ? "Nie ma decyzji tego rodzaju."
    : "Nic tu jeszcze nie ma.";
});

/** Green for putting something back, red for taking it away, grey for the rest:
 * the column is scanned rather than read, and those are the two a reader is
 * usually looking for. */
function actionColor(value: AuditAction): string | undefined {
  if (value === "restore" || value === "publish") return "success";
  if (value === "delete" || value === "reject") return "error";
  return undefined;
}

/** `at` is ISO 8601 in UTC. Rendered in the reader's zone, because a log is
 * read against "was I awake when this happened". */
function formatAt(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** @param more whether to append the next page rather than start over. */
async function load(more = false) {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  pending.value = true;
  error.value = null;
  try {
    const data = await authRequest<AuditLog>("/api/admin/audit", {
      method: "GET",
      query: {
        limit: 50,
        ...(action.value ? { action: action.value } : {}),
        ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}),
      },
    });
    // Deduplicated by id rather than concatenated: a page ends on a timestamp
    // boundary, and the endpoint would rather serve one row twice than step
    // over a decision taken in the same millisecond as the last one shown.
    if (more) {
      const seen = new Set(rows.value.map((row) => row.id));
      rows.value = [
        ...rows.value,
        ...data.entries.filter((row) => !seen.has(row.id)),
      ];
    } else {
      rows.value = data.entries;
    }
    nextCursor.value = data.nextCursor;
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się wczytać dziennika.";
  } finally {
    pending.value = false;
  }
}

async function restore(row: AuditRow) {
  restoring.value = row.id;
  error.value = null;
  try {
    const result = await authRequest<EdgeRestored>("/api/edges/restore", {
      body: { edge_id: row.target_id },
    });
    // The row keeps its place - it still records the removal, which happened -
    // and only loses the button, because the relation is no longer removed.
    rows.value = rows.value.map((entry) =>
      entry.target_id === row.target_id && entry.action === "delete"
        ? { ...entry, restorable: false }
        : entry,
    );
    notice.value = result.published
      ? "Powiązanie wróciło na stronę."
      : "Powiązanie wróciło jako szkic - żeby było widoczne publicznie, opublikuj je w „Powiązaniach”.";
    noticeShown.value = true;
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się przywrócić powiązania.";
  } finally {
    restoring.value = null;
  }
}

onMounted(() => load());
</script>

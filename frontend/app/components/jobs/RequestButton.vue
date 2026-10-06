<template>
  <template v-if="isDatascience">
    <ButtonIconAction
      v-if="variant === 'icon'"
      :icon="mdiDatabaseArrowRightOutline"
      :label="label"
      :tooltip="tooltip"
      data-testid="job-request-open"
      @click="open = true"
    />
    <v-btn
      v-else
      variant="outlined"
      :prepend-icon="mdiDatabaseArrowRightOutline"
      data-testid="job-request-open"
      @click="open = true"
    >
      {{ label }}
    </v-btn>

    <v-dialog v-model="open" max-width="600" scrollable>
      <v-card data-testid="job-request-dialog">
        <v-card-title class="text-wrap">{{ title }}</v-card-title>
        <v-card-text>
          <template v-if="!requested">
            <p class="text-body-2 mb-3">
              <template v-if="target === 'company'">
                Zbudujemy paczki wszystkich osób, które według naszych danych -
                rejestr.io i odpisów z KRS - pracowały albo pracują w
                <strong>{{ name || "tej spółce" }}</strong
                >, i wyślemy na stronę te, które coś na niej zmienią: brakujące
                stanowiska, kandydatury, partie. Osoby, których serwis jeszcze
                nie ma, dostaną nowe, nieopublikowane strony - trafią do kolejki
                do przejrzenia.
              </template>
              <template v-else>
                Zbudujemy paczkę <strong>{{ name || "tej osoby" }}</strong> z
                najnowszych danych i wyślemy ją na tę stronę, jeśli coś na niej
                zmieni. Nowej strony nie zakładamy, a gdy dane nie dają się
                jednoznacznie przypisać do tej osoby, nic nie wyślemy i powiemy
                dlaczego.
              </template>
            </p>
            <p class="text-body-2 text-medium-emphasis mb-3">
              Robi to maszyna koryta-nightly, zwykle w kilka minut. Postęp widać
              na stronie Procesy.
            </p>

            <!-- The page's last runs, so a second click is a decision rather
                 than an accident - a run still going is handed back anyway. -->
            <div v-if="runs.length" class="mb-3" data-testid="job-request-runs">
              <div class="text-caption text-medium-emphasis mb-1">
                Ostatnie zlecenia
              </div>
              <div
                v-for="run in runs.slice(0, 3)"
                :key="run.id"
                class="job-request__run text-body-2"
                :data-run="run.id"
              >
                <v-chip
                  size="small"
                  label
                  :color="`ink-${chipOf(run).tone}`"
                  :prepend-icon="chipOf(run).icon"
                >
                  {{ chipOf(run).title }}
                </v-chip>
                <span>{{ shortWarsawTime(run.startedAt, now) }}</span>
                <span v-if="run.request?.dryRun" class="text-medium-emphasis">
                  tylko liczenie
                </span>
                <NuxtLink :to="runLink(run.id)">zobacz</NuxtLink>
              </div>
            </div>

            <v-checkbox
              v-model="dryRun"
              label="Tylko policz - nic nie wysyłaj"
              density="compact"
              hide-details
              data-testid="job-request-dry-run"
            />

            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
              data-testid="job-request-error"
            >
              {{ error }}
            </v-alert>
          </template>

          <!-- Asked: where to follow it. -->
          <v-alert
            v-else
            type="success"
            variant="tonal"
            data-testid="job-request-done"
          >
            <p class="mb-2">
              {{
                requested.reused
                  ? "To zlecenie już czeka albo trwa - oto ono."
                  : "Zlecone."
              }}
              {{ dispatchText(requested.run) }}
            </p>
            <NuxtLink
              :to="requested.link"
              class="font-weight-bold"
              data-testid="job-request-follow"
            >
              Śledź postęp na stronie Procesy
              <v-icon :icon="mdiArrowRight" size="small" />
            </NuxtLink>
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="open = false">
            {{ requested ? "Zamknij" : "Anuluj" }}
          </v-btn>
          <v-btn
            v-if="!requested"
            color="primary"
            variant="flat"
            :loading="sending"
            data-testid="job-request-confirm"
            @click="confirm"
          >
            {{ dryRun ? "Policz" : "Wyślij" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { mdiArrowRight, mdiDatabaseArrowRightOutline } from "@mdi/js";
import { useAuthState } from "~/composables/auth";
import {
  useNodeJobRequests,
  useTickingNow,
  type JobRequested,
} from "~/composables/opsJobs";
import { runChip } from "~/utils/jobStyle";
import {
  jobDefinition,
  PEOPLE_REQUEST,
  runLink,
  shortWarsawTime,
  type JobRun,
  type RequestTarget,
} from "~~/shared/jobs";

/** Ask for a company's people, or a person, to be sent to the site now: the
 * datascience group's button on those pages. It queues a run the VM does
 * (server/utils/jobRequests.ts) and hands back the /admin/procesy link that
 * follows it. Gates itself on the claim, like the page's other admin
 * controls, so a page can place it unconditionally. */

const props = withDefaults(
  defineProps<{
    nodeId: string;
    target: RequestTarget;
    name?: string | null;
    /** `icon`: one of the square buttons in a person page's header. */
    variant?: "icon" | "button";
  }>(),
  { name: null, variant: "button" },
);

const { isDatascience } = useAuthState();
const { runs, error, sending, load, request } = useNodeJobRequests(
  toRef(props, "nodeId"),
);
const { now, tick } = useTickingNow(30_000);

const open = ref(false);
const dryRun = ref(false);
const requested = ref<JobRequested | null>(null);

/** The button's own words: short, since on a phone the company card's
 * buttons get a 311px row each and „…z tej firmy” ran off its edge. The page
 * says which firm; the dialog's title says it again. */
const label = computed(() =>
  props.target === "company" ? "Wyślij dane osób" : "Wyślij dane tej osoby",
);
const title = computed(() =>
  props.target === "company"
    ? "Wyślij dane osób z tej firmy"
    : "Wyślij dane tej osoby",
);
const tooltip = computed(
  () => `${title.value} - z najnowszych danych, na żądanie`,
);

const definition = jobDefinition(PEOPLE_REQUEST)!;
const chipOf = (run: JobRun) => runChip(run, definition, now.value);

watch(open, (opened) => {
  if (!opened) return;
  requested.value = null;
  error.value = "";
  tick();
  void load();
});

async function confirm() {
  const answer = await request(dryRun.value);
  if (answer) requested.value = answer;
}

function dispatchText(run: JobRun): string {
  if (run.state !== "queued") return "";
  if (run.dispatch?.ok) return "Maszyna się uruchamia.";
  if (run.dispatch?.error) {
    return "Maszyny nie udało się uruchomić - zlecenie zrobi najbliższa noc.";
  }
  return "Zrobi je najbliższa noc.";
}
</script>

<style scoped>
.job-request__run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 2px 0;
}
</style>

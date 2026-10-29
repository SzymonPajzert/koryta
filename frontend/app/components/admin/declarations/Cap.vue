<template>
  <div
    class="dcap"
    :class="{ 'dcap--hero': hero, 'dcap--off': off }"
    data-testid="declarations-cap"
    :data-limit="dailyLimit"
  >
    <div class="dcap__figure">
      <StatsStatTile
        :label="hero ? 'Opublikowane dziś automatycznie' : 'Dziś'"
        :value="today"
        :unit="off ? undefined : `z ${dailyLimit}`"
        :hero="hero"
        :hint="off ? 'publikowanie automatyczne wyłączone' : undefined"
      />

      <!-- One cell a person, so a limit of ten reads as ten places and how
           many are taken - the limit is small on purpose, and a plain bar
           would make 7 of 10 look like 70 of 100. Past thirty cells they
           stop being countable, and the bar is plain. The empty cells are
           the neutral ink, faint: the remainder grey of the charts all but
           vanishes on the sage tint. -->
      <div v-if="!off" class="dcap__meter">
        <v-progress-linear
          :model-value="Math.min(today, dailyLimit)"
          :max="dailyLimit"
          :chunk-count="dailyLimit <= MAX_CELLS ? dailyLimit : undefined"
          :chunk-gap="3"
          :height="hero ? 12 : 10"
          color="ink-success"
          bg-color="ink-neutral"
          :bg-opacity="0.2"
          :aria-label="`Opublikowane dziś: ${today} z ${dailyLimit}`"
        />
        <span v-if="today > dailyLimit" class="dcap__over">
          +{{ today - dailyLimit }} ponad limit
        </span>
      </div>
    </div>

    <div class="dcap__queue">
      <p class="dcap__queue-text" :data-cap-queued="queued">
        {{ queueText }}
      </p>

      <div v-if="queued > 0" class="dcap__actions">
        <template v-if="confirming">
          <span class="dcap__confirm">
            Opublikować teraz {{ queuedPeople
            }}{{ off ? " z kolejki" : ", ponad dzisiejszy limit" }}?
          </span>
          <v-btn
            size="small"
            variant="flat"
            color="ink-success"
            :loading="publishing"
            data-cap-publish-confirm
            @click="publish"
          >
            Opublikuj
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="publishing"
            @click="confirming = false"
          >
            Anuluj
          </v-btn>
        </template>
        <v-btn
          v-else
          size="small"
          variant="tonal"
          color="ink-success"
          :prepend-icon="mdiPublish"
          data-cap-publish
          @click="confirming = true"
        >
          Opublikuj z kolejki
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiPublish } from "@mdi/js";
import { declarationQueueDays } from "~/utils/declarationsAdmin";
import { nominativeNoun, polishNumber } from "~/composables/polish";

/** What the automation published today against its daily limit, and the
 * people waiting for the days after.
 *
 * The limit is what keeps a run of a hundred matches from going public in an
 * afternoon nobody watched, so it is drawn as places rather than a share, and
 * the queue says how many days it is at that pace. "Opublikuj z kolejki" is
 * the way past it, for a day an admin has looked at the queue and wants it
 * out - asked twice, since it publishes people. */
const props = defineProps<{
  today: number;
  /** 0 means the automation is switched off. */
  dailyLimit: number;
  queued: number;
  /** The publish request is out. */
  publishing?: boolean;
  /** The view's one big number, as the tiles variant has it. */
  hero?: boolean;
}>();

const emit = defineEmits<{ publish: [] }>();

const MAX_CELLS = 30;

const off = computed(() => props.dailyLimit <= 0);

const confirming = ref(false);
// A finished publish empties the queue; a failed one leaves the question up.
watch(
  () => props.queued,
  () => (confirming.value = false),
);

function publish() {
  emit("publish");
}

/** Who the button publishes, in the accusative a count takes after
 * "opublikować": jedną osobę, 2 osoby, 5 osób, 22 osoby. */
const queuedPeople = computed(() =>
  props.queued === 1
    ? "jedną osobę"
    : `${polishNumber(props.queued)} ${nominativeNoun(props.queued, "osobę", "osoby", "osób")}`,
);

/** „52 osoby czekają na kolejne dni, przy limicie 10 to około 6 dni.” The
 * verb agrees with the count the way the noun does. */
const queueText = computed(() => {
  const n = props.queued;
  if (n === 0) return "Nikt nie czeka w kolejce.";
  const noun = nominativeNoun(n, "osoba", "osoby", "osób");
  const verb = nominativeNoun(n, "czeka", "czekają", "czeka");
  const head = `${polishNumber(n)} ${noun} ${verb}`;
  const days = declarationQueueDays(n, props.dailyLimit);
  // Switched off, the tile above already says so.
  if (days === null) return `${head} w kolejce.`;
  if (days <= 1) return `${head} na kolejny dzień.`;
  return `${head} na kolejne dni, przy limicie ${polishNumber(props.dailyLimit)} to około ${polishNumber(days)} dni.`;
});
</script>

<style scoped>
.dcap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.dcap__figure,
.dcap__queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* Ten places read well up to about this wide; past it they are slabs. */
.dcap__meter {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 360px;
}

.dcap__meter > :first-child {
  flex: 1 1 auto;
}

.dcap__over {
  flex: none;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-ink-success));
  white-space: nowrap;
}

.dcap__queue-text {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  text-wrap: pretty;
}

.dcap__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dcap__confirm {
  flex-basis: 100%;
  font-size: 0.8125rem;
  font-weight: 500;
}

/* As the tiles' hero: the figure on the left at no more than the width ten
 * places read well at, the queue beside it behind a hairline, both on the
 * figure's foot - one band rather than a panel half empty. */
@media (min-width: 600px) {
  .dcap--hero {
    display: grid;
    grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
    align-items: end;
    gap: 16px 32px;
  }

  .dcap--hero .dcap__queue {
    align-self: stretch;
    justify-content: flex-end;
    max-width: 420px;
    padding-inline-start: 32px;
    border-inline-start: 1px solid
      rgba(var(--v-border-color), var(--v-border-opacity));
  }

  .dcap--hero .dcap__queue-text {
    font-size: 0.875rem;
  }
}
</style>

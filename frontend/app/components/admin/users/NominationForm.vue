<template>
  <form class="unom" data-nomination-form @submit.prevent="send">
    <h3 class="urow-heading">Nominuj</h3>

    <p v-if="row.current.owner" class="text-body-2 text-medium-emphasis mb-2">
      To konto właściciela serwisu. Zostaje administratorem - skrypt nie
      odbierze mu tego uprawnienia.
    </p>

    <v-radio-group
      v-model="level"
      hide-details
      density="compact"
      class="unom__levels"
      aria-label="Rola"
    >
      <v-radio
        v-for="option in options"
        :key="option.level"
        :value="option.level"
        :disabled="option.disabled"
        :data-level="option.level"
      >
        <template #label>
          <span class="unom__option">
            <strong>{{ option.title }}</strong>
            <span v-if="option.current" class="text-medium-emphasis">
              (teraz)
            </span>
            <span class="unom__hint">{{ option.hint }}</span>
          </span>
        </template>
      </v-radio>
    </v-radio-group>

    <!-- Only an administrator can be on trial. Ticked for somebody who is
         not one yet: a trial is how the site has taken on every new
         administrator since the activity feed began watching them. -->
    <v-checkbox
      v-if="level === 'admin'"
      v-model="trial"
      :label="trialLabel.title"
      :hint="trialLabel.hint"
      persistent-hint
      density="compact"
      class="unom__trial"
      data-trial-checkbox
    />

    <v-alert
      v-if="needsVerifiedEmail"
      type="warning"
      variant="tonal"
      density="compact"
      class="my-2"
      data-unverified-warning
    >
      Adres e-mail tego konta nie jest potwierdzony. Roli „{{
        roleLevelLabels[level].title
      }}” nie nadamy bez potwierdzonego adresu - każdy może założyć konto na
      cudzy e-mail.
    </v-alert>

    <v-textarea
      v-model="reason"
      label="Uzasadnienie"
      :counter="NOMINATION_REASON.max"
      hint="Właściciel przeczyta je w skrypcie, zanim zatwierdzi zmianę. Zostaje w historii konta."
      persistent-hint
      rows="2"
      auto-grow
      class="mt-2"
      data-nomination-reason
    />

    <div class="d-flex align-center flex-wrap ga-2 mt-3">
      <v-btn
        type="submit"
        color="primary"
        variant="flat"
        :disabled="!canSend"
        :loading="sending || busy"
        data-nominate
      >
        Zapisz nominację
      </v-btn>
      <span class="text-body-2 text-medium-emphasis" data-nomination-preview>
        {{ preview }}
      </span>
    </div>
  </form>
</template>

<script setup lang="ts">
/** The nomination form in an account's open row: the level it should have,
 * whether as an administrator on trial, and why.
 *
 * Saving changes nothing about the account. It writes the wish to
 * `roleNominations/{uid}`, and the claims change only when the owner runs the
 * script and says y - which is why the form says what it is asking for ("teraz
 * → po zatwierdzeniu") rather than "Zapisano rolę".
 *
 * Every check here is the route's too; they are made here so the button says
 * no before a round trip does. */
import { computed, ref, watch } from "vue";
import {
  describeRole,
  normalizeRoleState,
  roleLevelLabels,
  roleLevels,
  sameRoleState,
  trialLabel,
  type RoleLevel,
  type RoleState,
} from "~~/shared/roles";
import {
  levelsNeedingVerifiedEmail,
  NOMINATION_REASON,
  type AdminUserRow,
} from "~~/shared/userAdmin";

const props = defineProps<{
  row: AdminUserRow;
  busy?: boolean;
  /** Sends the nomination; resolves to whether it went through. */
  submit: (choice: RoleState & { reason: string }) => Promise<boolean>;
}>();

const rank = (level: RoleLevel) => roleLevels.indexOf(level);

/** Where the form starts: what was asked for already, if anything is waiting;
 * the team's level for somebody who asked for the team's tools; otherwise the
 * account as it is, so the first click is the change. */
function startingChoice(row: AdminUserRow): RoleState {
  const nomination = row.nomination;
  if (nomination?.pending) {
    return { level: nomination.desired.level, trial: nomination.desired.trial };
  }
  if (
    row.accessRequest?.status === "open" &&
    rank(row.current.level) < rank("datascience")
  ) {
    return { level: "datascience", trial: false };
  }
  return { level: row.current.level, trial: row.current.trial };
}

const start = startingChoice(props.row);
const level = ref<RoleLevel>(start.level);
const trial = ref(start.trial);
const reason = ref("");
const sending = ref(false);

// Ticked by default when the account is about to become an administrator, and
// otherwise left as the account has it, so choosing "Administrator" for one
// who already is changes nothing until the box is touched.
watch(level, (next, previous) => {
  if (next === "admin" && previous !== "admin") {
    trial.value =
      props.row.current.level === "admin" ? props.row.current.trial : true;
  }
});

const options = computed(() =>
  roleLevels.map((option) => ({
    level: option,
    ...roleLevelLabels[option],
    current: option === props.row.current.level,
    // The script keeps the owner an administrator whatever is asked, and the
    // route refuses to ask.
    disabled: props.row.current.owner && option !== "admin",
  })),
);

const choice = computed(() =>
  normalizeRoleState({ level: level.value, trial: trial.value }),
);

/** Nothing to send: the choice is what the account has and nothing else is
 * waiting, or it is exactly what is already waiting. */
const unchanged = computed(() => {
  const nomination = props.row.nomination;
  return nomination?.pending
    ? sameRoleState(choice.value, nomination.desired)
    : sameRoleState(choice.value, props.row.current);
});

const needsVerifiedEmail = computed(
  () =>
    !props.row.emailVerified &&
    levelsNeedingVerifiedEmail.includes(choice.value.level),
);

const reasonValid = computed(() => {
  const length = reason.value.trim().length;
  return length >= NOMINATION_REASON.min && length <= NOMINATION_REASON.max;
});

const canSend = computed(
  () =>
    !unchanged.value &&
    !needsVerifiedEmail.value &&
    reasonValid.value &&
    !sending.value &&
    !props.busy,
);

const preview = computed(() => {
  if (unchanged.value) {
    return props.row.nomination?.pending
      ? "Ta nominacja już czeka na skrypt."
      : "Bez zmian - konto ma już tę rolę.";
  }
  // The owner stays the owner through any change the script makes.
  const after = {
    ...choice.value,
    owner: props.row.current.owner && choice.value.level === "admin",
  };
  return `${describeRole(props.row.current)} → ${describeRole(after)} po zatwierdzeniu`;
});

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  try {
    const sent = await props.submit({
      ...choice.value,
      reason: reason.value.trim(),
    });
    if (sent) reason.value = "";
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.unom__levels :deep(.v-label) {
  opacity: 1;
}

.unom__option {
  display: block;
  padding: 4px 0;
}

.unom__hint {
  display: block;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.unom__trial {
  margin-inline-start: 32px;
}
</style>

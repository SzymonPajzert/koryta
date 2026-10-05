<template>
  <!-- `#u-<uid>` is the link the access-request buttons and anybody pasting a
       uid share; the page opens and scrolls to the row it names. -->
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="`u-${row.uid}`"
    class="urow"
    :tone="tone"
    :dimmed="row.robot"
    :highlighted="highlighted"
    :data-uid="row.uid"
    :data-section="section"
    data-user-row
  >
    <template #summary>
      <span class="arow-grow urow__who">
        <UserChip :uid="row.uid" :user="chipUser" />
        <span class="arow-tag" :class="toneClasses(roleTone)" data-role-chip>
          {{ describeRole(row.current) }}
        </span>
        <span
          v-if="row.nomination?.pending"
          class="arow-tag bg-surface-warning text-ink-warning"
          data-pending-chip
        >
          czeka na skrypt
        </span>
        <span
          v-if="isTrial"
          class="arow-tag"
          :class="due ? toneClasses('danger') : toneClasses('neutral')"
          :data-trial-due="due"
          data-trial-days
        >
          {{
            days === null
              ? "początek nieznany"
              : `od ${polishCountingGenitive(days, "dnia", "dni")}`
          }}
        </span>
        <span v-if="row.robot" class="arow-tag" :class="toneClasses('neutral')">
          konto techniczne
        </span>
        <span
          v-if="row.disabled"
          class="arow-tag"
          :class="toneClasses('danger')"
        >
          wyłączone
        </span>
      </span>
      <span
        class="arow-fixed urow__stat urow__stat--wide"
        title="Logowania i dni na stronie, liczone od wprowadzenia statystyk logowań - wcześniejszych nikt nie zapisywał"
        data-sign-ins
      >
        {{ signInsText }}
      </span>
      <span
        class="arow-fixed urow__stat urow__stat--seen"
        title="Ostatnio na stronie"
        data-last-seen
      >
        {{ formatDaysAgo(seenAt) }}
      </span>
      <span
        class="arow-fixed urow__stat urow__stat--wide urow__stat--activity"
        :title="`Oceny, propozycje zmian, źródła i publikacje z ostatnich ${USER_ACTIVITY_WINDOW_DAYS} dni`"
        data-activity
      >
        {{ activityText }}
      </span>
    </template>

    <template v-if="quickDecisions.length > 0" #actions>
      <v-btn
        v-for="decision in quickDecisions"
        :key="decision.key"
        icon
        size="small"
        variant="text"
        :color="decision.color"
        :aria-label="decision.label"
        :title="decision.label"
        :disabled="busy"
        :data-quick="decision.key"
        @click="ask(decision)"
      >
        <v-icon :icon="decision.icon" />
      </v-btn>
    </template>

    <template #meta>
      <AdminRowFact label="E-mail">
        {{ row.email ?? "brak adresu" }}
        <span
          :class="row.emailVerified ? 'text-ink-success' : 'text-ink-warning'"
          data-email-verified
        >
          · {{ row.emailVerified ? "potwierdzony" : "niepotwierdzony" }}
        </span>
      </AdminRowFact>
      <AdminRowFact label="Logowanie przez">{{ providersText }}</AdminRowFact>
      <AdminRowFact label="Konto od">{{
        formatDay(row.createdAt)
      }}</AdminRowFact>
      <AdminRowFact label="Ostatnie logowanie">
        {{ formatWhen(row.lastSignInAt) }}
      </AdminRowFact>
    </template>

    <div class="urow__body">
      <section v-if="row.accessRequest" class="urow__block" data-access-request>
        <h3 class="urow-heading">Prośba o dostęp</h3>
        <p class="urow__quote">{{ row.accessRequest.reason }}</p>
        <p class="text-caption text-medium-emphasis">
          {{ formatDay(row.accessRequest.createdAt) }} · z
          {{ requestSourceLabels[row.accessRequest.source] }} ·
          {{ requestStatusLabels[row.accessRequest.status] }}
        </p>
      </section>

      <section v-if="row.nomination" class="urow__block" data-nomination>
        <h3 class="urow-heading">
          {{
            row.nomination.pending ? "Nominacja czeka na skrypt" : "Nominacja"
          }}
        </h3>
        <p class="text-body-2">
          <strong>{{ describeRole(row.nomination.desired) }}</strong>
          · {{ actorLabel(row.nomination.desired) }},
          {{ formatDay(row.nomination.desired.at) }}
          <template v-if="!row.nomination.pending">
            · konto ma już tę rolę
          </template>
        </p>
        <p class="urow__quote">{{ row.nomination.desired.reason }}</p>
        <v-alert
          v-if="row.nomination.applyError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-2"
          data-apply-error
        >
          Skrypt nie zastosował tej nominacji
          {{ formatWhen(row.nomination.applyError.at) }}:
          {{ row.nomination.applyError.message }}
        </v-alert>
      </section>

      <section class="urow__block">
        <v-progress-linear
          v-if="detail?.loading && !detail.data"
          indeterminate
          data-detail-loading
        />
        <v-alert
          v-if="detail?.error"
          type="error"
          variant="tonal"
          density="compact"
          data-detail-error
        >
          {{ detail.error }}
          <template #append>
            <v-btn size="small" variant="text" @click="emit('retry')">
              Spróbuj ponownie
            </v-btn>
          </template>
        </v-alert>
        <AdminUsersStats v-if="detail?.data" :detail="detail.data" />
      </section>

      <section class="urow__block">
        <AdminUsersNominationForm
          v-if="!row.robot && !self"
          :key="nominationKey"
          :row="row"
          :busy="busy"
          :submit="nominate"
        />
        <p v-else class="text-body-2 text-medium-emphasis" data-no-nomination>
          {{
            self
              ? "To Twoje konto - nominować samego siebie nie można. Poproś innego administratora."
              : "Konto techniczne (pipeline albo migracja) - jego uprawnień nie zmienia się nominacją."
          }}
        </p>
      </section>

      <section v-if="!row.robot" class="urow__block">
        <AdminUsersModeration :row="row" :busy="busy" :moderate="moderate" />
      </section>

      <section v-if="detail?.data" class="urow__block">
        <AdminUsersHistory :entries="detail.data.history" />
      </section>
    </div>

    <template #footer>
      <v-btn
        v-for="decision in footerDecisions"
        :key="decision.key"
        size="small"
        variant="tonal"
        :color="decision.color"
        :prepend-icon="decision.icon"
        :disabled="busy"
        :data-decision="decision.key"
        @click="ask(decision)"
      >
        {{ decision.label }}
      </v-btn>
      <!-- The script's name in quotes rather than <code>: the system
           monospace draws a pixel apart on CI and here, which is what kept
           /admin/procesy's visual baselines from ever matching CI. -->
      <span class="urow__note text-caption text-medium-emphasis">
        Zmiana roli zacznie działać dopiero wtedy, gdy właściciel uruchomi
        skrypt „set_auth_claims” i ją zatwierdzi.
      </span>
    </template>
  </AdminExpandRow>

  <AdminUsersReasonDialog
    v-model="dialogOpen"
    :title="asked?.title ?? ''"
    :text="asked?.text"
    :confirm-label="asked?.confirm ?? ''"
    :color="asked?.color"
    :required="asked?.required"
    :limits="NOMINATION_REASON"
    :loading="sending"
    @confirm="decide"
  />
</template>

<script setup lang="ts">
/** One account on /admin/uzytkownicy: a line to tell it from the others, and in
 * the open row everything there is to decide about it.
 *
 * The line says who it is, the role the account holds now (from its claims,
 * read by the server - not from anybody's token), whether a nomination is
 * waiting for the script, how often the person signs in, when they were last
 * here and how much they did in 90 days. The open row adds the request or the
 * nomination that put the account in its section, the counts behind a decision
 * (fetched when the row first opens), the nomination form, moderation and the
 * account's history.
 *
 * The decisions that are the point of a section - turn down a request,
 * withdraw a nomination, end a trial either way - sit on the line too, so a
 * queue can be worked through without opening every row. All of them only
 * record a wish: the footer says so, because a nomination saved here changes
 * nobody's role until the owner runs the script.
 *
 * Writes go through `act`, which resolves to whether they went through; a
 * dialog or a form closes itself on success and keeps what was typed when the
 * server says no. */
import { computed, ref } from "vue";
import {
  mdiAccountCancelOutline,
  mdiCheckDecagramOutline,
  mdiCloseCircleOutline,
  mdiUndoVariant,
} from "@mdi/js";
import {
  actorLabel,
  lastSeenAt,
  trialDays,
  trialDue,
  type UserAction,
  type UserDetailState,
  type UserSectionKey,
} from "~/composables/adminUsers";
import { polishCounting, polishCountingGenitive } from "~/composables/polish";
import type { RowTone } from "~/composables/rowTone";
import { formatDaysAgo } from "~/utils/chartTheme";
import { toneClasses } from "~/utils/jobStyle";
import { describeRole, type RoleLevel, type RoleState } from "~~/shared/roles";
import {
  ACCESS_REQUEST_COOLDOWN_DAYS,
  NOMINATION_REASON,
  USER_ACTIVITY_WINDOW_DAYS,
  type AccessRequestSource,
  type AccessRequestStatus,
  type AdminUserRow,
  type ModerationAction,
} from "~~/shared/userAdmin";

const props = defineProps<{
  row: AdminUserRow;
  section: UserSectionKey;
  /** The clock trial days are counted against. */
  now: Date;
  /** The account is the reader's own. */
  self?: boolean;
  detail?: UserDetailState;
  /** A write to this account is in flight. */
  busy?: boolean;
  highlighted?: boolean;
  /** Sends one write; resolves to whether it went through. */
  act: (action: UserAction) => Promise<boolean>;
}>();

const emit = defineEmits<{
  /** Ask for the detail again after it failed. */
  retry: [];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const chipUser = computed(() => ({
  displayName: props.row.displayName,
  email: props.row.email,
  photoURL: props.row.photoURL,
}));

const roleTones: Record<RoleLevel, RowTone> = {
  normal: "neutral",
  trusted: "info",
  datascience: "success",
  admin: "sage",
};
const roleTone = computed(() => roleTones[props.row.current.level]);

const isTrial = computed(
  () => props.row.current.level === "admin" && props.row.current.trial,
);
const days = computed(() => trialDays(props.row, props.now));
const due = computed(() => trialDue(props.row, props.now));

/** The rail says what the row is waiting for: a request (info), the script
 * (warning), a trial past its review date (danger). */
const tone = computed<RowTone>(() => {
  switch (props.section) {
    case "requests":
      return "info";
    case "pending":
      return "warning";
    case "trials":
      return due.value ? "danger" : "sage";
    case "team":
      return props.row.current.level === "admin" ? "strong" : "sage";
    default:
      return "neutral";
  }
});

const seenAt = computed(() => lastSeenAt(props.row));

/** Sign-ins and active days, as `userStats` has counted them. It began
 * counting when it was deployed, so a small number can be an old account
 * rather than a rare visitor - the title on the line says as much. */
const signInsText = computed(() => {
  const signIns = props.row.signIns;
  if (!signIns) return "—";
  return (
    `${polishCounting(signIns.count, "logowanie", "logowania", "logowań")} · ` +
    polishCounting(signIns.activeDays, "dzień", "dni", "dni")
  );
});

const activityText = computed(() =>
  props.row.activity
    ? `${props.row.activity.total} w ${USER_ACTIVITY_WINDOW_DAYS} dni`
    : "—",
);

const providerLabels: Record<string, string> = {
  "google.com": "Google",
  password: "e-mail i hasło",
};
const providersText = computed(
  () =>
    props.row.providers
      .map((provider) => providerLabels[provider] ?? provider)
      .join(", ") || "—",
);

const requestSourceLabels: Record<AccessRequestSource, string> = {
  pomoc: "/pomoc",
  rozszerzenie: "/rozszerzenie",
  profil: "/profil",
};
const requestStatusLabels: Record<AccessRequestStatus, string> = {
  open: "czeka na decyzję",
  nominated: "zakończona nominacją",
  dismissed: "odrzucona",
};

const formatDay = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pl-PL", { dateStyle: "medium" })
    : "—";
const formatWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

/** Remounts the form when what it starts from changes - a nomination saved,
 * withdrawn or applied - so it opens on the new state rather than the old. */
const nominationKey = computed(() =>
  [
    props.row.current.level,
    props.row.current.trial,
    props.row.nomination?.desired.at ?? "",
    props.row.nomination?.pending ?? false,
  ].join("|"),
);

const nominate = (choice: RoleState & { reason: string }) =>
  props.act({
    kind: "nominate",
    body: { uid: props.row.uid, ...choice },
  });

const moderate = (action: ModerationAction, reason: string) =>
  props.act({
    kind: "moderate",
    body: { uid: props.row.uid, action, reason },
  });

// ---- decisions ----

type DecisionKey = "dismiss" | "withdraw" | "graduate" | "revoke";

type Decision = {
  key: DecisionKey;
  label: string;
  icon: string;
  color: string;
  title: string;
  text: string;
  confirm: string;
  required: boolean;
};

const decisions = computed<Record<DecisionKey, Decision>>(() => ({
  dismiss: {
    key: "dismiss",
    label: "Odrzuć prośbę",
    icon: mdiCloseCircleOutline,
    color: "ink-danger",
    title: "Odrzucić prośbę o dostęp?",
    text:
      "Rola konta się nie zmieni. Osoba zobaczy, że prośbę rozpatrzono, i " +
      `będzie mogła poprosić ponownie za ${ACCESS_REQUEST_COOLDOWN_DAYS} dni.`,
    confirm: "Odrzuć",
    required: false,
  },
  withdraw: {
    key: "withdraw",
    label: "Wycofaj nominację",
    icon: mdiUndoVariant,
    color: "ink-warning",
    title: "Wycofać nominację?",
    text:
      "Skrypt nie będzie miał nic do zrobienia: konto zostaje przy roli " +
      `„${describeRole(props.row.current)}”.`,
    confirm: "Wycofaj",
    required: false,
  },
  graduate: {
    key: "graduate",
    label: "Zakończ okres próbny",
    icon: mdiCheckDecagramOutline,
    color: "ink-success",
    title: "Zakończyć okres próbny?",
    // Says nothing of signing out, unlike "revoke" below: ending a trial takes
    // away only `newAdmin`, and the script does not revoke anybody's sessions
    // for that - the person keeps working and the menu catches up on its own.
    text:
      "Nominacja na administratora bez okresu próbnego. Gdy właściciel ją " +
      "zatwierdzi, decyzje tej osoby przestaną być osobno pokazywane na " +
      "stronie Aktywność.",
    confirm: "Nominuj",
    required: true,
  },
  revoke: {
    key: "revoke",
    label: "Odbierz uprawnienia",
    icon: mdiAccountCancelOutline,
    color: "ink-danger",
    title: "Odebrać uprawnienia?",
    text:
      "Nominacja na zwykłego uczestnika. Gdy właściciel ją zatwierdzi, konto " +
      "straci uprawnienia administratora i zespołu, a jego sesje zostaną " +
      "wylogowane.",
    confirm: "Nominuj",
    required: true,
  },
}));

/** Nothing to decide about one's own account or a robot's - the route refuses
 * both. */
const decidable = computed(() => !props.self && !props.row.robot);

/** Every decision the account's state allows, for the open row's footer. */
const footerDecisions = computed(() => {
  if (!decidable.value) return [];
  const list: Decision[] = [];
  if (props.row.accessRequest?.status === "open") {
    list.push(decisions.value.dismiss);
  }
  if (props.row.nomination?.pending) list.push(decisions.value.withdraw);
  if (isTrial.value) {
    list.push(decisions.value.graduate, decisions.value.revoke);
  }
  return list;
});

/** The ones the row's section is about, on the line itself. */
const quickDecisions = computed(() => {
  if (!decidable.value) return [];
  const keys: Record<UserSectionKey, DecisionKey[]> = {
    requests: ["dismiss"],
    pending: ["withdraw"],
    trials: ["graduate", "revoke"],
    team: [],
    others: [],
  };
  return footerDecisions.value.filter((decision) =>
    keys[props.section].includes(decision.key),
  );
});

const asked = ref<Decision | null>(null);
const dialogOpen = ref(false);
const sending = ref(false);

function ask(decision: Decision) {
  asked.value = decision;
  dialogOpen.value = true;
}

function actionFor(key: DecisionKey, reason: string): UserAction {
  const uid = props.row.uid;
  const optional = reason || undefined;
  switch (key) {
    case "dismiss":
      return { kind: "dismiss", body: { uid, reason: optional } };
    case "withdraw":
      return { kind: "withdraw", body: { uid, reason: optional } };
    case "graduate":
      return {
        kind: "nominate",
        body: { uid, level: "admin", trial: false, reason },
      };
    case "revoke":
      return {
        kind: "nominate",
        body: { uid, level: "normal", trial: false, reason },
      };
  }
}

async function decide(reason: string) {
  if (!asked.value) return;
  sending.value = true;
  try {
    if (await props.act(actionFor(asked.value.key, reason))) {
      dialogOpen.value = false;
    }
  } finally {
    sending.value = false;
  }
}
</script>

<style>
/* Unscoped, like `AdminExpandRow`'s: the headings and quotes are used by the
 * parts of the open row (the form, moderation, history), each its own
 * component. Every name is `urow`-prefixed. */

/* Wraps rather than truncates: `arow-grow` gives way to the counts beside it,
 * and a person's role, trial and "czeka na skrypt" pills are wider than a
 * phone leaves for the name - which then shrank to the avatar alone. The name
 * keeps a line of its own and the pills go under it. */
.urow__who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  white-space: normal;
}

.urow__who > :first-child {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}

.urow__stat {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.urow__stat--seen {
  min-width: 84px;
  text-align: end;
}

.urow__stat--activity {
  min-width: 84px;
  text-align: end;
}

.urow__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.urow__block:empty {
  display: none;
}

.urow-heading {
  margin-bottom: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-ink-neutral));
}

.urow__quote {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-inline-start: 10px;
  border-inline-start: 3px solid rgba(var(--v-border-color), 0.24);
}

.urow__note {
  flex: 1 1 260px;
}

/* On a phone the line keeps the person, their role and when they were last
 * here; the counts are one tap away in the open row. */
@media (max-width: 599.98px) {
  .urow__stat--wide {
    display: none;
  }

  .urow__stat--seen {
    min-width: 0;
  }
}
</style>

<template>
  <article
    :id="link.id"
    ref="root"
    class="k-card link-row"
    :class="`link-row--${link.strength.toLowerCase()}`"
    :data-rank="link.rank"
    :data-testid="`powiazanie-${link.id}`"
  >
    <div class="link-row__grid">
      <div class="link-row__side">
        <!-- A button, so a tap opens the explanation: a tooltip opens on hover
             and focus, and a phone has neither. -->
        <button
          type="button"
          class="link-row__letter"
          :class="`link-row__letter--${link.strength.toLowerCase()}`"
          :aria-label="`Klasa ${link.strength}: ${strength.short}`"
        >
          {{ link.strength }}
          <v-tooltip
            activator="parent"
            location="bottom"
            max-width="320"
            :open-on-hover="!touch"
            :open-on-click="touch"
          >
            <strong>{{ link.strength }} · {{ strength.short }}.</strong>
            {{ strength.long }}
            <template v-if="identityUnconfirmed">
              {{ CONTRACT_LINK_FLAG_LABELS.identity_unconfirmed }}.</template
            >
          </v-tooltip>
        </button>
        <span class="link-row__amount">{{ plnCompact(link.total) }}</span>
        <span class="link-row__status" :class="`text-${status.ink}`">
          <v-icon :icon="status.icon" size="15" aria-hidden="true" />
          {{ CONTRACT_LINK_STATUS_LABELS[link.status] }}
        </span>
        <v-chip
          v-if="link.visibility === 'gated'"
          size="x-small"
          variant="outlined"
          class="text-ink-neutral"
        >
          tylko dla zalogowanych
        </v-chip>
      </div>

      <div class="link-row__main">
        <div class="link-row__who">
          <span class="link-row__name">{{ lead.name }}</span>
          <!-- Not for a namesake: „dziś w urzędzie" beside a name the research
               could not tie to the office asserts it of somebody else. -->
          <span
            v-if="lead.inOfficeNow && !identityUnconfirmed"
            class="link-row__now"
          >
            dziś w urzędzie
          </span>
          <span v-if="people.length > 1" class="link-row__more">
            +{{ people.length - 1 }}
            {{ nominativeNoun(people.length - 1, "osoba", "osoby", "osób") }}
          </span>
        </div>
        <div v-if="leadOffice" class="link-row__office">{{ leadOffice }}</div>

        <dl class="link-row__facts">
          <dt>Firma</dt>
          <dd>
            <strong>{{ companyShortName(link.company) }}</strong>
            <span v-if="leadRole" class="text-ink-neutral">
              · {{ leadRole }}</span
            >
            <span v-if="controlLine" class="link-row__control">
              {{ controlLine }}
            </span>
          </dd>
          <dt>Płaci</dt>
          <dd>
            <strong>{{ payer }}</strong>
            <span class="text-ink-neutral">
              <template v-if="otherBuyers > 0">
                i {{ otherBuyers }}
                {{
                  nominativeNoun(
                    otherBuyers,
                    "inna jednostka",
                    "inne jednostki",
                    "innych jednostek",
                  )
                }}</template
              >
              · {{ link.deals }}
              {{ nominativeNoun(link.deals, "umowa", "umowy", "umów") }}</span
            >
          </dd>
        </dl>

        <div v-if="reason || warnings.length" class="link-row__notes">
          <span v-if="reason" class="link-row__reason">{{ reason }}</span>
          <span v-for="flag in warnings" :key="flag" class="link-row__warning">
            <v-icon :icon="mdiAlertOutline" size="14" aria-hidden="true" />
            {{ CONTRACT_LINK_FLAG_LABELS[flag] }}
          </span>
        </div>

        <p v-if="link.why" class="link-row__why">{{ link.why }}</p>

        <p
          v-if="hiddenTies"
          class="link-row__hidden"
          data-testid="powiazanie-ukryte-osoby"
        >
          <v-icon :icon="mdiLockOutline" size="14" aria-hidden="true" />
          {{ hiddenTies }}
          <NuxtLink v-if="loginLink" :to="loginLink" @click="emit('gate', link)"
            >Załóż konto</NuxtLink
          >
        </p>
      </div>
    </div>

    <div class="link-row__actions">
      <v-btn
        variant="text"
        color="ink-strong"
        size="small"
        :append-icon="open ? mdiChevronUp : mdiChevronDown"
        :aria-expanded="open"
        data-testid="powiazanie-rozwin"
        @click="toggle"
      >
        {{ open ? "Zwiń" : "Szczegóły i umowy" }}
      </v-btn>
      <!-- Icon only on a phone, where three labelled buttons wrap into two
           rows on every card; the name is in `aria-label` either way. -->
      <v-btn
        variant="text"
        color="ink-strong"
        size="small"
        class="link-row__secondary"
        :prepend-icon="copied ? mdiCheck : mdiLinkVariant"
        aria-label="Kopiuj link do tego powiązania"
        data-testid="powiazanie-link"
        @click="copyLink"
      >
        <span class="link-row__action-label">{{
          copied ? "Skopiowano" : "Kopiuj link"
        }}</span>
      </v-btn>
      <v-btn
        variant="text"
        color="ink-strong"
        size="small"
        class="link-row__secondary"
        :prepend-icon="mdiMessageAlertOutline"
        aria-label="Zgłoś błąd w tym powiązaniu"
        data-testid="powiazanie-zglos"
        @click="report"
      >
        <span class="link-row__action-label">Zgłoś błąd</span>
      </v-btn>
      <v-btn
        v-if="isAdmin"
        variant="text"
        color="ink-strong"
        size="small"
        :prepend-icon="
          link.visibility === 'public' ? mdiEyeOffOutline : mdiEyeOutline
        "
        data-testid="powiazanie-widocznosc"
        @click="
          emit(
            'visibility',
            link.id,
            link.visibility === 'public' ? 'gated' : 'public',
          )
        "
      >
        {{
          link.visibility === "public"
            ? "Ukryj przed niezalogowanymi"
            : "Pokaż wszystkim"
        }}
      </v-btn>
    </div>
    <span class="d-sr-only" aria-live="polite">{{
      copied ? "Skopiowano link do tego powiązania." : ""
    }}</span>
    <!-- The browser would not let us at the clipboard: the address itself,
         selectable, rather than a „Skopiowano" over whatever was there. -->
    <p v-if="copyFallback" class="link-row__fallback">
      Skopiuj ręcznie: <span class="link-row__url">{{ copyFallback }}</span>
    </p>

    <div v-if="open" class="link-row__detail">
      <section class="mb-3">
        <h4 class="link-row__detail-head">Firma</h4>
        <p class="text-body-2 mb-0">
          <strong>{{ link.company }}</strong>
        </p>
        <p v-if="link.companySeat" class="text-body-2 mb-0">
          siedziba: {{ link.companySeat }}
        </p>
        <p
          v-if="identifiers.length"
          class="text-body-2 mb-0"
          data-testid="powiazanie-rejestry"
        >
          <template
            v-for="(identifier, index) in identifiers"
            :key="`${identifier.register}-${identifier.value}`"
          >
            <template v-if="index"> · </template>
            {{ identifier.register }}
            <a
              v-if="identifier.url"
              :href="identifier.url"
              target="_blank"
              rel="nofollow noopener"
              title="Wpis w KRS w serwisie rejestr.io"
              >{{ identifier.value }}</a
            ><template v-else>{{ identifier.value }}</template>
          </template>
        </p>
      </section>

      <section v-for="person in people" :key="person.name" class="mb-3">
        <h4 class="link-row__detail-name">{{ person.name }}</h4>
        <ul v-if="personOfficeLines(person).length" class="link-row__offices">
          <li v-for="line in personOfficeLines(person)" :key="line">
            {{ line }}
          </li>
        </ul>
        <p v-if="personRoleLine(person, true)" class="text-body-2 mb-1">
          W firmie: {{ personRoleLine(person, true) }}
        </p>
        <p
          v-if="person.committees.length"
          class="text-caption text-ink-neutral mb-0"
        >
          Komitety: {{ person.committees.join(", ") }}
        </p>
      </section>

      <section
        v-if="link.ties.length"
        class="mb-3"
        data-testid="powiazanie-osoby"
      >
        <h4 class="link-row__detail-head">Powiązane osoby w firmie</h4>
        <ul class="link-row__offices">
          <li v-for="tie in link.ties" :key="tie.name">
            <strong>{{ tie.name }}</strong> — {{ tie.tie
            }}<template v-if="tie.family">; {{ tie.family }}</template
            ><template v-if="!tie.confirmed"> (niepotwierdzone)</template>
          </li>
        </ul>
      </section>

      <section class="mb-3">
        <h4 class="link-row__detail-head">Kto płacił</h4>
        <p class="text-body-2 mb-1">{{ linkSentence(link, false) }}</p>
        <ul class="link-row__offices">
          <li v-for="buyer in link.buyers" :key="buyer.name">
            {{ buyer.name }} — {{ plnCompact(buyer.value) }} ({{
              buyer.contracts
            }}
            {{ nominativeNoun(buyer.contracts, "umowa", "umowy", "umów") }})
          </li>
          <li v-if="unlistedBuyers" class="text-ink-neutral">
            {{ unlistedBuyers }}
          </li>
        </ul>
        <p v-if="notes.length" class="text-caption text-ink-neutral mb-0">
          {{ notes.join(" · ") }}
        </p>
      </section>

      <h4 class="link-row__detail-head">Umowy z rejestru</h4>
      <ContractLinkContracts
        :link-id="link.id"
        :deals="link.deals"
        :initial="contracts"
      />

      <!-- A second „Zwiń" where the reader is once the list is read: the one
           above can be sixty contracts back up the page. -->
      <div class="link-row__actions mt-2">
        <v-btn
          variant="text"
          color="ink-strong"
          size="small"
          :append-icon="mdiChevronUp"
          data-testid="powiazanie-zwin"
          @click="collapse"
        >
          Zwiń
        </v-btn>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiHelpCircleOutline,
  mdiLinkVariant,
  mdiLockOutline,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { useMediaQuery } from "@vueuse/core";
import { nominativeNoun } from "~/composables/polish";
import { trackGoal } from "~/composables/analytics";
import { useFeedbackSubject } from "~/composables/feedback";
import { useFeedbackDialog } from "~/composables/feedbackDialog";
import {
  contractLinkPath,
  controlNowLine,
  hiddenTiesLine,
  linkSentence,
  orderedPeople,
  otherBuyerCount,
  personOfficeLine,
  personOfficeLines,
  personRoleLine,
  strengthReason,
  unlistedBuyersLine,
} from "~/utils/contractLinks";
import { plnCompact } from "~~/shared/money";
import { companyShortName } from "~~/shared/names";
import { companyIdentifiers } from "~~/shared/identifiers";
import type { ContractRow } from "~~/shared/contracts";
import {
  CONTRACT_LINK_FLAG_LABELS,
  CONTRACT_LINK_FLAG_WARNS,
  CONTRACT_LINK_STATUS_LABELS,
  CONTRACT_LINK_STRENGTH_LABELS,
  type ContractLinkRow,
  type ContractLinkStatus,
  type ContractLinkVisibility,
} from "~~/shared/contractLinks";

/** One finding, as a row of a list somebody works through: the class and the
 * amount on the right, who, which firm and who paid on the left, the caveats
 * as words rather than icons, and everything else - every office, the
 * researched ties, the payers, the contracts - behind „Szczegóły". */
const {
  link,
  isAdmin = false,
  startOpen = false,
  loginLink = "",
  contracts = undefined,
} = defineProps<{
  link: ContractLinkRow;
  isAdmin?: boolean;
  /** Open from the start: the finding a `?powiazanie=` link points at. */
  startOpen?: boolean;
  /** Where „Załóż konto" goes when an anonymous reader is told there are more
   * people behind this finding. Without it the sentence stands alone. */
  loginLink?: string;
  /** The contracts behind the finding, where the page fetched them with it
   * (a `?powiazanie=` link); without them the list asks once it is opened. */
  contracts?: ContractRow[];
}>();
const emit = defineEmits<{
  visibility: [id: string, visibility: ContractLinkVisibility];
  /** The reader followed `loginLink`. */
  gate: [link: ContractLinkRow];
}>();

const STATUS: Record<ContractLinkStatus, { icon: string; ink: string }> = {
  verified: { icon: mdiCheckCircleOutline, ink: "ink-sage" },
  plausible: { icon: mdiHelpCircleOutline, ink: "ink-warning" },
  unreviewed: { icon: mdiAlertCircleOutline, ink: "ink-neutral" },
};

const people = computed(() => orderedPeople(link.people));
const lead = computed(() => people.value[0]!);
/** The office, then what the research added to it („wicestarosta testowski
 * od 2024 r.") - often the one fact that makes the letter make sense. */
const leadOffice = computed(() =>
  [personOfficeLine(lead.value), lead.value.officeNote]
    .filter(Boolean)
    .join(" · "),
);
const leadRole = computed(() => personRoleLine(lead.value));
const controlLine = computed(() => controlNowLine(link));
const identityUnconfirmed = computed(() =>
  link.flags.includes("identity_unconfirmed"),
);
const strength = computed(() => CONTRACT_LINK_STRENGTH_LABELS[link.strength]);
const status = computed(() => STATUS[link.status]);
const payer = computed(
  () => link.buyers[0]?.name ?? link.topContract?.buyer.name ?? "",
);
const otherBuyers = computed(() => otherBuyerCount(link));
const unlistedBuyers = computed(() => unlistedBuyersLine(link));
const hiddenTies = computed(() => hiddenTiesLine(link.hiddenTies ?? 0));
const identifiers = computed(() => [
  ...link.krs.flatMap((krsNumber) => companyIdentifiers({ krsNumber })),
  ...companyIdentifiers({ nipNumber: link.nip }),
]);
const reason = computed(() => strengthReason(link));
const warnings = computed(() =>
  link.flags.filter((flag) => CONTRACT_LINK_FLAG_WARNS[flag]),
);
/** The flags that say how the total was counted rather than whether to
 * believe it - shown once the reader asks for details. */
const notes = computed(() =>
  link.flags
    .filter((flag) => !CONTRACT_LINK_FLAG_WARNS[flag])
    .map((flag) => CONTRACT_LINK_FLAG_LABELS[flag]),
);

/** Tap to open where there is no hover to open it by. Not both everywhere: a
 * tap is also a synthetic mouseenter, and the two would open and close it in
 * one gesture. */
const touch = useMediaQuery("(hover: none)");

const root = ref<HTMLElement | null>(null);
const open = ref(startOpen);
/** Once per card: reopening one to check a figure is not a second read. And
 * not for a card a link opened, which nobody clicked. */
let tracked = false;
function toggle() {
  open.value = !open.value;
  if (open.value && !tracked) {
    tracked = true;
    trackGoal("powiazania:open", { strength: link.strength });
  }
}

/** The bottom „Zwiń": the detail folds away from under the reader, so bring
 * the card back to where they can see it. */
async function collapse() {
  open.value = false;
  await nextTick();
  if (root.value && root.value.getBoundingClientRect().top < 0) {
    root.value.scrollIntoView({ block: "start" });
  }
}

const copied = ref(false);
const copyFallback = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

/** The link somebody sends. A gated finding goes out as `ukryte_<rank>`, not
 * as its own id: `cru_<nip>` puts the NIP in a url that gets pasted anywhere,
 * and an anonymous recipient would get a 404 for it where the rank gets them
 * the teaser and the way in. */
async function copyLink() {
  const id = link.visibility === "public" ? link.id : `ukryte_${link.rank}`;
  const url = `${window.location.origin}${contractLinkPath(id)}`;
  try {
    // Inside the try: on an insecure origin `navigator.clipboard` is
    // undefined, and reading it throws before there is a promise to reject.
    await navigator.clipboard.writeText(url);
  } catch {
    copyFallback.value = url;
    return;
  }
  copyFallback.value = "";
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 2500);
}

const feedbackOpen = useFeedbackDialog();
const feedbackSubject = useFeedbackSubject();
/** The site's own „Zgłoś" dialog, about this finding rather than the page:
 * the report carries the finding's own link, which is what an admin needs to
 * find it among 420 on one url. Open to anonymous readers, as the dialog is. */
function report() {
  feedbackSubject.value = {
    route: contractLinkPath(link.id),
    title: `Powiązanie: ${companyShortName(link.company)}`,
  };
  feedbackOpen.value = true;
}
</script>

<style scoped>
.link-row {
  padding: 14px 16px 6px 20px;
  /* Clear of the app bar when a `?powiazanie=` link or the bottom „Zwiń"
     scrolls the card to the top. */
  scroll-margin-top: 80px;
}

.link-row::before {
  background: var(--rail);
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

.link-row--a {
  --rail: rgb(var(--v-theme-ink-danger));
}
.link-row--b {
  --rail: rgb(var(--v-theme-ink-warning));
}
.link-row--c {
  --rail: rgb(var(--v-theme-ink-info));
}
.link-row--d {
  --rail: rgb(var(--v-theme-ink-neutral));
}

/* The amount leads on a phone - it is what a reader compares while scrolling -
   and sits on the right from the width where a row has room for two columns. */
.link-row__grid {
  display: grid;
  gap: 8px 20px;
  grid-template-areas: "side" "main";
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 720px) {
  .link-row__grid {
    grid-template-areas: "main side";
    grid-template-columns: minmax(0, 1fr) auto;
  }
}

.link-row__side {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  grid-area: side;
}

@media (min-width: 720px) {
  .link-row__side {
    align-items: flex-end;
    flex-direction: column;
    text-align: right;
  }
}

.link-row__letter {
  align-items: center;
  border: 0;
  border-radius: 4px;
  cursor: help;
  display: inline-flex;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  height: 22px;
  justify-content: center;
  padding: 0;
  position: relative;
  width: 22px;
}

/* A 44px target around a 22px letter, without drawing a bigger letter. */
.link-row__letter::after {
  content: "";
  inset: -11px;
  position: absolute;
}

.link-row__letter--a {
  background: rgb(var(--v-theme-surface-danger));
  color: rgb(var(--v-theme-ink-danger));
}
.link-row__letter--b {
  background: rgb(var(--v-theme-surface-warning));
  color: rgb(var(--v-theme-ink-warning));
}
.link-row__letter--c {
  background: rgb(var(--v-theme-surface-info));
  color: rgb(var(--v-theme-ink-info));
}
.link-row__letter--d {
  background: rgb(var(--v-theme-surface-muted));
  color: rgb(var(--v-theme-ink-neutral));
}

.link-row__amount {
  font-size: 1.45rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
}

.link-row__status {
  align-items: center;
  display: inline-flex;
  font-size: 0.8rem;
  gap: 4px;
  white-space: nowrap;
}

.link-row__main {
  grid-area: main;
  min-width: 0;
}

.link-row__who {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
}

.link-row__name {
  font-size: 1.08rem;
  font-weight: 600;
}

.link-row__now {
  background: rgb(var(--v-theme-surface-sage));
  border-radius: 4px;
  color: rgb(var(--v-theme-ink-sage));
  font-size: 0.75rem;
  font-weight: 600;
  padding: 1px 6px;
}

.link-row__more {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.82rem;
}

.link-row__office {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.88rem;
  margin-top: 2px;
  overflow-wrap: anywhere;
}

/* Labels in a column of their own, so a wrapped name hangs under the name and
   not under the label. */
.link-row__facts {
  display: grid;
  font-size: 0.9rem;
  gap: 3px 10px;
  grid-template-columns: 3.4em minmax(0, 1fr);
  margin: 8px 0 0;
}

.link-row__facts dt {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding-top: 3px;
  text-transform: uppercase;
}

.link-row__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.link-row__notes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 8px;
}

.link-row__reason {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 4px;
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.78rem;
  padding: 1px 6px;
}

.link-row__warning {
  align-items: center;
  color: rgb(var(--v-theme-ink-warning));
  display: inline-flex;
  font-size: 0.78rem;
  gap: 3px;
}

.link-row__why {
  font-size: 0.88rem;
  line-height: 1.45;
  margin: 8px 0 0;
}

.link-row__control {
  color: rgb(var(--v-theme-ink-neutral));
  display: block;
  font-size: 0.82rem;
}

.link-row__hidden {
  align-items: baseline;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  flex-wrap: wrap;
  font-size: 0.82rem;
  gap: 0 6px;
  margin: 8px 0 0;
}

.link-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  margin: 4px -8px 0 0;
}

.link-row__actions :deep(.v-btn) {
  min-height: 36px;
}

/* A thumb, not a cursor: 44px on a phone. The two secondary actions drop
   their words there, or three buttons wrap into two rows on every card. */
@media (max-width: 599px) {
  .link-row__actions :deep(.v-btn) {
    min-height: 44px;
    min-width: 44px;
  }

  .link-row__action-label {
    display: none;
  }

  .link-row__secondary :deep(.v-btn__prepend) {
    margin-inline: 0;
  }
}

.link-row__fallback {
  font-size: 0.82rem;
  margin: 4px 0 0;
  text-align: right;
}

.link-row__url {
  overflow-wrap: anywhere;
  user-select: all;
}

.link-row__detail {
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
  margin-top: 4px;
  padding: 12px 0 10px;
}

.link-row__detail-name {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 2px;
}

.link-row__detail-head {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin: 0 0 4px;
  text-transform: uppercase;
}

.link-row__offices {
  font-size: 0.88rem;
  margin: 0 0 4px;
  overflow-wrap: anywhere;
  padding-left: 18px;
}
</style>

<template>
  <section
    class="link-hero"
    :class="{ 'link-hero--compact': compact }"
    data-testid="powiazania-hero"
  >
    <p class="link-hero__eyebrow">
      Powiązania z rejestru umów<template v-if="period">
        · {{ period }}</template
      >
    </p>

    <!-- A reader who picked a województwo gets that region's line and not
         the national headline: the filter has to show on the first screen,
         and „w podlaskiem X zł" is the sentence a reporter came for. The
         region's figure covers every class - the summary has no per-class
         split per region - and says so. -->
    <div
      v-if="summary && region"
      class="link-hero__region"
      data-testid="powiazania-region"
    >
      <p class="link-hero__region-name">Województwo płatnika: {{ woj }}</p>
      <p class="link-hero__line">
        <strong>{{ polishNumber(region.links) }}</strong>
        {{
          nominativeNoun(region.links, "powiązanie", "powiązania", "powiązań")
        }}
        na <strong>{{ plnCompact(region.total) }}</strong
        >, we wszystkich klasach, także słabszej D.
        <span v-if="!signedIn && !resolving && region.gated">
          {{ polishNumber(region.gated) }} z nich widzą tylko zalogowani.
        </span>
      </p>
    </div>

    <!-- Signed in, or about to be: one line. They have read the headline
         before, and the list is what they came back for. -->
    <p
      v-else-if="summary && compact"
      class="link-hero__line"
      data-testid="powiazania-hero-linia"
    >
      <strong>{{ polishNumber(summary.links) }}</strong>
      {{
        nominativeNoun(summary.links, "powiązanie", "powiązania", "powiązań")
      }}
      · <strong>{{ plnCompact(strongTotal) }}</strong> w klasach A–C<template
        v-if="weakTotal"
        >, {{ plnCompact(weakTotal) }} w słabszych D</template
      ><template v-if="signedIn">
        · widzisz wszystkie, także niesprawdzone</template
      >
    </p>

    <template v-else>
      <!-- A–C and not the grand total: three quarters of that is class D -
           candidates who never won, seats from the nineties - and a headline
           built on it is twenty times the story the strong findings tell. -->
      <div class="link-hero__total" data-testid="powiazania-suma">
        {{ summary ? plnCompact(strongTotal) : "—" }}
      </div>
      <p class="link-hero__lead">
        tyle instytucje publiczne zapłaciły firmom powiązanym w KRS z osobą z
        władz samorządu albo z kimś jej bliskim — w powiązaniach klas A–C.
      </p>
      <p
        v-if="summary && weakTotal"
        class="link-hero__weak"
        data-testid="powiazania-slabsze"
      >
        Kolejne {{ plnCompact(weakTotal) }} to słabsze powiązania klasy D:
        kandydowanie bez mandatu, mandat sprzed lat albo pieniądze spoza terenu
        mandatu.
      </p>

      <dl v-if="summary" class="link-hero__stats">
        <div>
          <dd>{{ polishNumber(summary.links) }}</dd>
          <dt>
            {{
              nominativeNoun(
                summary.links,
                "powiązanie",
                "powiązania",
                "powiązań",
              )
            }}
          </dt>
        </div>
        <div>
          <dd>{{ polishNumber(summary.verified) }}</dd>
          <dt>
            {{
              nominativeNoun(
                summary.verified,
                "sprawdzone",
                "sprawdzone",
                "sprawdzonych",
              )
            }}
          </dt>
        </div>
        <!-- People, not findings: one councillor behind two firms is one
             person in office. -->
        <div>
          <dd>{{ polishNumber(summary.inOfficePeople) }}</dd>
          <dt>
            {{
              nominativeNoun(
                summary.inOfficePeople,
                "osoba dziś w urzędzie",
                "osoby dziś w urzędzie",
                "osób dziś w urzędzie",
              )
            }}
          </dt>
        </div>
      </dl>
    </template>

    <!-- How to read a card. Open on a desktop for a first-time reader;
         behind a toggle on a phone, where it used to push the first finding
         a whole screen down, and for anybody on the compact hero. CSS decides
         which, not `useDisplay()`, which under SSR says phone to everybody. -->
    <button
      type="button"
      class="link-hero__toggle"
      :aria-expanded="explainOpen"
      aria-controls="link-hero-explain"
      data-testid="powiazania-jak-czytac"
      @click="explainOpen = !explainOpen"
    >
      Jak czytać listę
      <v-icon
        :icon="explainOpen ? mdiChevronUp : mdiChevronDown"
        size="18"
        aria-hidden="true"
      />
    </button>
    <div
      id="link-hero-explain"
      class="link-hero__explain"
      :class="{ 'link-hero__explain--open': explainOpen }"
    >
      <!-- The three labels a card uses, in the order it uses them, so a reader
           learns to read the list once, here. -->
      <ol class="link-hero__steps">
        <li>
          <span class="link-hero__step">1</span>
          <!-- Every card's first line, and about half of them name somebody
               who only ever ran: „z władz samorządu" alone was untrue of
               them. -->
          <span
            ><strong>Osoba</strong> z władz samorządu albo kandydująca do
            nich</span
          >
        </li>
        <li>
          <span class="link-hero__step">2</span>
          <span><strong>Firma</strong>, którą kieruje albo współposiada</span>
        </li>
        <li>
          <span class="link-hero__step">3</span>
          <span><strong>Płaci</strong>: samorząd albo urząd</span>
        </li>
      </ol>

      <ul v-if="summary" class="link-hero__legend">
        <li v-for="strength in contractLinkStrengths" :key="strength">
          <span
            class="link-hero__letter"
            :class="`link-hero__letter--${strength.toLowerCase()}`"
          >
            {{ strength }}
          </span>
          {{ CONTRACT_LINK_STRENGTH_LABELS[strength].short }}
          <span class="link-hero__count">
            {{ polishNumber(summary.byStrength[strength]) }} ·
            {{ plnCompact(summary.totalByStrength[strength]) }}
          </span>
        </li>
      </ul>
    </div>

    <!-- Held back while firebase restores a session this browser had last
         time: a signed-in reader used to be told to create an account for
         the two seconds before the page caught up. -->
    <div
      v-if="!signedIn && resolving"
      class="link-hero__pending"
      aria-hidden="true"
    />
    <div v-else-if="!signedIn && summary" class="link-hero__ask">
      <v-btn
        color="primary"
        variant="flat"
        size="large"
        :prepend-icon="mdiLockOutline"
        :to="loginLink"
        class="link-hero__button"
        data-testid="powiazania-hero-rejestracja"
        @click="emit('gate')"
      >
        Załóż konto i zobacz wszystkie
      </v-btn>
      <!-- The stake, and honestly: most of the money behind the login is in
           the weakest class, and the ask says so rather than let the sum
           imply a quarter-billion of councillors' own gminas. -->
      <p
        v-if="!region"
        class="link-hero__note"
        data-testid="powiazania-hero-stawka"
      >
        <!-- The list below says this itself on a phone, where the hero was
             a full screen before the first finding. -->
        <span class="link-hero__note-public">
          Najmocniejsze sprawdzone powiązania ({{
            polishNumber(summary.public)
          }}) pokazujemy wszystkim, z nazwiskami.
        </span>
        {{ polishNumber(summary.gated) }} z
        {{ polishCountingGenitive(summary.links, "powiązania", "powiązań") }}
        widzą tylko zalogowani — z nazwiskami, firmami i umowami.<template
          v-if="summary.totalGated"
        >
          Razem to {{ plnCompact(summary.totalGated)
          }}<template v-if="mostlyWeak"
            >, w większości w słabszych powiązaniach klasy D</template
          >.</template
        >
        Konto jest bezpłatne.
      </p>
    </div>

    <p class="link-hero__caveat">
      Powiązanie to nie zarzut: to zbieżność zapisów w KRS, na listach PKW i w
      Centralnym Rejestrze Umów, którą warto sprawdzić.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiChevronDown, mdiChevronUp, mdiLockOutline } from "@mdi/js";
import {
  nominativeNoun,
  polishCountingGenitive,
  polishNumber,
} from "~/composables/polish";
import {
  contractLinkGatedMostlyWeak,
  contractLinkStrongTotal,
  contractLinkWeakTotal,
} from "~/composables/contractLinks";
import { linkPeriod } from "~/utils/contractLinks";
import { plnCompact } from "~~/shared/money";
import {
  CONTRACT_LINK_STRENGTH_LABELS,
  contractLinkStrengths,
  type ContractLinkSummary,
} from "~~/shared/contractLinks";

/** The focal point of the page: what the findings add up to, how to read a
 * card, and - for a reader without an account - the one ask. A dark band
 * rather than a red one: red is the class A rail below, and a red block over a
 * list of names reads as an alarm rather than as a finding to check.
 *
 * Three shapes. The full one for a first-time, anonymous reader; one line for
 * a signed-in reader (and for one firebase is still restoring); and one line
 * about the region when the list is filtered to a województwo. */
const {
  summary,
  signedIn,
  woj = null,
  resolving = false,
} = defineProps<{
  summary: ContractLinkSummary | null;
  signedIn: boolean;
  loginLink: string;
  /** The list's województwo filter, already normalised. */
  woj?: string | null;
  /** A session is probably being restored (`useLikelyReader`). */
  resolving?: boolean;
}>();
const emit = defineEmits<{ gate: [] }>();

const explainOpen = ref(false);

const period = computed(() =>
  summary ? linkPeriod(summary.from, summary.to) : "",
);

const region = computed(() =>
  woj ? (summary?.byWojewodztwo[woj] ?? null) : null,
);
const compact = computed(() => signedIn || resolving || !!region.value);

const strongTotal = computed(() =>
  summary ? contractLinkStrongTotal(summary) : 0,
);
const weakTotal = computed(() =>
  summary ? contractLinkWeakTotal(summary) : 0,
);
const mostlyWeak = computed(() =>
  summary ? contractLinkGatedMostlyWeak(summary) : false,
);
</script>

<style scoped>
.link-hero {
  background: rgb(var(--v-theme-ink-strong));
  border-radius: 12px;
  color: #fff;
  padding: 20px 20px 18px;
}

@media (min-width: 840px) {
  .link-hero {
    padding: 28px 32px 22px;
  }

  .link-hero--compact {
    padding: 18px 32px 16px;
  }
}

.link-hero__eyebrow {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  margin: 0;
  opacity: 0.8;
  text-transform: uppercase;
}

.link-hero__total {
  font-size: clamp(2.6rem, 9vw, 4.5rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.05;
  margin: 6px 0 4px;
}

.link-hero__lead {
  font-size: 1rem;
  line-height: 1.45;
  margin: 0;
  max-width: 44em;
  opacity: 0.92;
}

.link-hero__weak {
  font-size: 0.9rem;
  line-height: 1.45;
  margin: 8px 0 0;
  max-width: 48em;
  opacity: 0.8;
}

.link-hero__region-name {
  font-size: 0.9rem;
  margin: 6px 0 0;
  opacity: 0.85;
}

.link-hero__line {
  font-size: 1.05rem;
  line-height: 1.45;
  margin: 6px 0 0;
}

.link-hero__line strong {
  font-size: 1.25rem;
}

.link-hero__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 18px 0 0;
}

.link-hero__stats div {
  display: flex;
  flex-direction: column;
}

.link-hero__stats dd {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}

.link-hero__stats dt {
  font-size: 0.82rem;
  opacity: 0.8;
}

/* One row on a phone, the captions wrapping under their figures: three
   figures on two rows were another 60px before the first finding. */
@media (max-width: 599.98px) {
  .link-hero__stats {
    flex-wrap: nowrap;
    gap: 16px;
    margin-top: 14px;
  }

  .link-hero__stats div {
    flex: 0 1 auto;
    min-width: 0;
  }

  .link-hero__stats dd {
    font-size: 1.3rem;
  }

  .link-hero__stats dt {
    font-size: 0.76rem;
    line-height: 1.25;
  }
}

.link-hero__toggle {
  align-items: center;
  color: inherit;
  display: inline-flex;
  font-size: 0.9rem;
  gap: 4px;
  margin-top: 8px;
  min-height: 44px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Collapsed unless opened... */
.link-hero__explain:not(.link-hero__explain--open) {
  display: none;
}

/* ...except on the full hero from a tablet up, where there is room and it is
   the reader's first visit. */
@media (min-width: 600px) {
  .link-hero:not(.link-hero--compact) .link-hero__explain {
    display: block;
  }

  .link-hero:not(.link-hero--compact) .link-hero__toggle {
    display: none;
  }
}

.link-hero__steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
}

.link-hero__steps li {
  align-items: center;
  display: flex;
  font-size: 0.9rem;
  gap: 6px;
}

.link-hero__step {
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  display: inline-flex;
  flex: none;
  font-size: 0.75rem;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.link-hero__legend {
  display: grid;
  gap: 4px 20px;
  grid-template-columns: 1fr;
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
}

@media (min-width: 720px) {
  .link-hero__legend {
    grid-template-columns: 1fr 1fr;
  }
}

.link-hero__legend li {
  align-items: center;
  display: flex;
  font-size: 0.88rem;
  gap: 8px;
}

.link-hero__count {
  margin-left: auto;
  opacity: 0.75;
  white-space: nowrap;
}

.link-hero__letter {
  align-items: center;
  border-radius: 4px;
  display: inline-flex;
  flex: none;
  font-size: 0.75rem;
  font-weight: 700;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.link-hero__letter--a {
  background: rgb(var(--v-theme-surface-danger));
  color: rgb(var(--v-theme-ink-danger));
}
.link-hero__letter--b {
  background: rgb(var(--v-theme-surface-warning));
  color: rgb(var(--v-theme-ink-warning));
}
.link-hero__letter--c {
  background: rgb(var(--v-theme-surface-info));
  color: rgb(var(--v-theme-ink-info));
}
.link-hero__letter--d {
  background: rgb(var(--v-theme-surface-muted));
  color: rgb(var(--v-theme-ink-neutral));
}

.link-hero__ask {
  margin-top: 16px;
}

.link-hero__pending {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  height: 48px;
  margin-top: 16px;
  max-width: 320px;
}

.link-hero__button {
  min-height: 48px;
  width: 100%;
}

/* The label wraps rather than spilling past the button: at 360px „ZAŁÓŻ KONTO
   I ZOBACZ WSZYSTKIE" was 30px wider than the green, with the lock outside it
   on the dark band. */
@media (max-width: 599.98px) {
  .link-hero__button {
    height: auto !important;
    padding-block: 10px;
  }

  .link-hero__button :deep(.v-btn__content) {
    letter-spacing: normal;
    line-height: 1.25;
    white-space: normal;
  }
}

@media (min-width: 600px) {
  .link-hero__button {
    width: auto;
  }
}

.link-hero__note {
  font-size: 0.9rem;
  line-height: 1.45;
  margin: 10px 0 0;
  opacity: 0.9;
}

@media (max-width: 599.98px) {
  .link-hero__note-public {
    display: none;
  }
}

.link-hero__caveat {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 0.8rem;
  margin: 16px 0 0;
  opacity: 0.75;
  padding-top: 10px;
}

.link-hero--compact .link-hero__caveat {
  margin-top: 8px;
}
</style>

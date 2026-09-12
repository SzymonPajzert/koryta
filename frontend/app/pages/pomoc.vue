<template>
  <div class="pomoc">
    <!-- Header -->
    <h1 class="text-h4 font-weight-bold mb-2">Jak możesz pomóc</h1>
    <p class="text-body-1 text-medium-emphasis mb-1">
      Koryta.pl prowadzą ochotnicy - po godzinach i bez sponsorów. Niżej jest
      wszystko, co można przy tym robić: od jednej minuty do stałej współpracy.
      <NuxtLink to="/o-nas" class="text-ink-info"
        >Dowiedz się więcej o projekcie</NuxtLink
      >.
    </p>
    <p v-if="total" class="text-body-2 text-medium-emphasis mb-1">
      Sprawdziliśmy {{ polishNumber(checked) }} z
      {{ polishCountingGenitive(total, "osoby", "osób") }}. Reszty nikt jeszcze
      nie sprawdzał.
    </p>
    <!-- The answer to „czy muszę mieć konto?”, put where it decides whether a
         reader scrolls at all. The page used to promise „nie potrzebujesz
         konta” directly above two links that both carry the auth middleware. -->
    <p class="text-caption text-medium-emphasis mb-6">
      Przy każdej rzeczy piszemy, czego wymaga: nic, konta albo wpłaty. Konto
      zakładasz w niecałą minutę, a po zalogowaniu wracasz dokładnie w to
      miejsce, z którego klikasz.
    </p>

    <!-- Six self-sort tiles. Nothing on the page is hidden behind them - a
         reader who ignores them and scrolls still meets every option. -->
    <h2 class="text-h6 mb-3">Wybierz swoją drogę</h2>
    <v-row class="mb-4">
      <v-col v-for="tile in tiles" :key="tile.path" cols="6" sm="4">
        <v-card
          :href="`#${tile.path}`"
          height="100%"
          variant="outlined"
          rounded="lg"
          hover
          class="pa-4"
          @click="trackGoal('pomoc:path', { path: tile.path })"
        >
          <v-icon :icon="tile.icon" size="28" :color="tile.ink" class="mb-2" />
          <div class="text-subtitle-2 font-weight-bold">{{ tile.title }}</div>
          <div class="text-caption text-medium-emphasis d-none d-sm-block mt-1">
            {{ tile.desc }}
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Masz minutę -->
    <section id="minuta" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Masz minutę</h2>
        <span class="text-caption text-medium-emphasis">Minuta</span>
        <InfoBubble label="Masz minutę">
          To są rzeczy, które w sumie robią najwięcej: każde zgłoszenie od
          czytelnika trafia prosto do nas, a każdy podesłany link przyprowadza
          kogoś, kto zna temat lepiej niż my.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Nic z tego nie wymaga konta.
      </p>
      <v-row>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiMessageAlertOutline"
            title="Napisz, co jest nie tak"
            desc="Błąd w danych, literówka, pomysł na stronę - wystarczy jedno zdanie, także anonimowo. To ten sam przycisk, który masz w prawym dolnym rogu każdej strony."
            ink="ink-sage"
            access="none"
            @activate="openFeedback"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiShareVariantOutline"
            title="Podeślij komuś link"
            desc="W tabeli ustaw filtr - na przykład swój region - kliknij „Kopiuj link” i wyślij go komuś, kogo to dotyczy."
            to="/eksploruj/tabela"
            ink="ink-sage"
            access="none"
            @click="task('tabela')"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiFacebook"
            href="https://www.facebook.com/people/Korytapl/61581508966044/"
            title="Obserwuj i udostępniaj"
            desc="Jesteśmy na Facebooku, X, Instagramie i GitHubie - pozostałe linki są w stopce."
            ink="ink-sage"
            access="none"
            @click="trackGoal('cta:community', { to: 'facebook-page' })"
          />
        </v-col>
      </v-row>
    </section>

    <!-- Wiesz coś, czego my nie wiemy -->
    <section id="wiem-cos" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Wiesz coś, czego my nie wiemy</h2>
        <span class="text-caption text-medium-emphasis">Kilka minut</span>
        <InfoBubble label="Wiesz coś, czego my nie wiemy">
          Nie musisz niczego udowadniać ani pisać ładnie. Wystarczy nazwisko,
          nazwa spółki albo link do artykułu - resztę sprawdzimy. Wszystko, co
          dopiszesz, ma autora i trafia do kolejki, którą przegląda redakcja;
          nic nie pojawia się na stronie samo.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Najbardziej brakuje nam wiedzy lokalnej - kto u Ciebie dostał posadę i
        po kim.
      </p>
      <v-row>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiAccountPlusOutline"
            title="Dopisz brakującą osobę"
            desc="Wystarczy imię i nazwisko - resztę pól możesz zostawić pustą."
            ink="ink-info"
            access="login"
            @activate="openPropose('person')"
          />
        </v-col>
        <!-- Its own card rather than „osobę albo spółkę” on one: the dialog
             renders the form for the type it was mounted with, so a single
             card would have filed every company as a pending person. -->
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiDomainPlus"
            title="Dopisz brakującą spółkę albo instytucję"
            desc="Wystarczy nazwa - KRS, REGON i resztę możesz zostawić pustą."
            ink="ink-info"
            access="login"
            @activate="openPropose('place')"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiLinkVariantPlus"
            title="Podeślij artykuł"
            desc="Wklej link do artykułu prasowego, a pobierzemy go i wyciągniemy z niego fakty."
            to="/zrodla"
            ink="ink-info"
            access="login"
            @click="task('zrodla')"
          />
        </v-col>
      </v-row>

      <!-- Open on the page rather than behind a bubble: this is the
           highest-value visitor's whole path, and it must not be one card.
           Nothing in the list is a link - each row describes something found
           where the reader already is, on a person, a company or an article. -->
      <v-card variant="outlined" rounded="lg" class="pa-4 mt-4">
        <div class="text-subtitle-2 font-weight-bold mb-1">
          Reszta jest tam, gdzie i tak jesteś - przy osobie, spółce albo
          artykule
        </div>
        <v-list density="compact" class="bg-transparent">
          <v-list-item
            v-for="row in inPlace"
            :key="row.title"
            :prepend-icon="row.icon"
            :title="row.title"
            :subtitle="row.subtitle"
            lines="two"
          />
        </v-list>
      </v-card>
    </section>

    <!-- Sprawdzaj razem z nami -->
    <section id="sprawdzanie" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Sprawdzaj razem z nami</h2>
        <span class="text-caption text-medium-emphasis">Kwadrans</span>
        <InfoBubble label="Sprawdzaj razem z nami">
          Kolejka pokazuje osoby, o których wiemy tylko tyle, że mają posadę w
          spółce albo instytucji publicznej. Twoje zadanie: sprawdzić, czy tę
          posadę tłumaczy polityka - partia, kampania, rodzina, znajomość z
          ratusza - i ocenić ją w skali od -5 do +5. Niczego tym nie
          publikujesz: oceny i notatki układają kolejkę, a publikuje redakcja.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        To jest główna praca projektu i tu najbardziej brakuje rąk.
      </p>
      <div class="k-note mb-4 d-flex flex-wrap align-center ga-3">
        <span class="text-body-2">
          Te cztery rzeczy wymagają konta - zakładasz je w niecałą minutę, a po
          zalogowaniu wracasz dokładnie w to miejsce, z którego klikasz.
        </span>
        <v-btn
          variant="text"
          rounded="lg"
          class="text-none"
          color="ink-info"
          to="/login?redirect=/pomoc"
          text="Załóż konto"
        />
      </div>
      <v-row>
        <v-col
          v-for="card in checkingCards"
          :key="card.title"
          cols="12"
          sm="6"
          md="4"
        >
          <CardAction
            :icon="card.icon"
            :title="card.title"
            :desc="card.desc"
            :to="card.to"
            ink="ink-info"
            access="login"
            @click="task(card.task)"
          />
        </v-col>
      </v-row>
    </section>

    <!-- Dołącz do zespołu -->
    <section id="zespol" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Dołącz do zespołu</h2>
        <span class="text-caption text-medium-emphasis">Na dłużej</span>
        <InfoBubble label="Dołącz do zespołu">
          Nie szukamy wyłącznie programistów. Przydaje się research, OSINT,
          prawo, UX, redakcja, analiza danych i cierpliwość do rejestrów. Po
          ankiecie odzywamy się z konkretnym zadaniem, a nie z listą obowiązków.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Jeśli chcesz robić coś regularnie, a nie tylko przy okazji.
      </p>
      <v-row>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiAccountPlusOutline"
            :href="VOLUNTEER_FORM"
            title="Zostań wolontariuszem"
            desc="Krótka ankieta o tym, co potrafisz. Odezwiemy się z konkretnym zadaniem."
            ink="ink-sage"
            access="none"
            @click="trackGoal('cta:volunteer-form', { from: 'pomoc' })"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiSlack"
            href="https://join.slack.com/t/korytapl/shared_invite/zt-3mx37782c-X2tRnWIYdMkSJm5oqK6yqQ"
            title="Dołącz na Slacku"
            desc="Tam umawiamy się, kto co robi. Możesz wejść i na początku tylko poczytać."
            ink="ink-sage"
            access="none"
            @click="trackGoal('cta:community', { to: 'slack' })"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiFacebook"
            href="https://www.facebook.com/groups/korytapl"
            title="Grupa na Facebooku"
            desc="Nowości i znaleziska - dla tych, którzy wolą śledzić projekt niż w nim siedzieć."
            ink="ink-sage"
            access="none"
            @click="trackGoal('cta:community', { to: 'facebook' })"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiEmailOutline"
            href="mailto:kontakt@koryta.pl"
            title="Napisz do nas"
            desc="kontakt@koryta.pl - odpisujemy."
            ink="ink-sage"
            access="none"
            @click="task('kontakt')"
          />
        </v-col>
        <!-- Named as real work and chipped „dla zespołu”, rather than linked as
             if anyone can click it: the extension is gated on the datascience
             claim. It goes to /rozszerzenie rather than to a mailto, because
             that page says what the tool is and tells a reader without the
             claim to write to us - which a mailto cannot. Nothing linked to it
             from here before. -->
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiToolboxOutline"
            to="/rozszerzenie"
            title="Narzędzia dla stałych wolontariuszy"
            desc="Wtyczka do przeglądarki, która zapisuje czytany artykuł - także zza paywalla - i od razu wyciąga z niego fakty. O dostęp poproś mailem albo na Slacku."
            ink="ink-neutral"
            access="team"
            @click="task('narzedzia')"
          />
        </v-col>
      </v-row>
    </section>

    <!-- Wesprzyj finansowo -->
    <section id="pieniadze" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Wesprzyj finansowo</h2>
        <span class="text-caption text-medium-emphasis"
          >Jednorazowo albo co miesiąc</span
        >
        <InfoBubble label="Wesprzyj finansowo">
          Pieniądze idą na serwery, domenę, zapytania do rejestrów i narzędzia,
          które przetwarzają artykuły. Nikt tu nie bierze pensji.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Nie mamy sponsorów ani żadnej partii za plecami. Utrzymujemy się z
        wpłat.
      </p>
      <v-row>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiHeartOutline"
            href="https://patronite.pl/romb.me"
            title="Wpłacaj co miesiąc na Patronite"
            desc="Nawet dziesięć złotych miesięcznie daje nam przewidywalność."
            ink="ink-warning"
            access="none"
            @click="trackGoal('cta:donate', { to: 'patronite' })"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiPiggyBankOutline"
            href="https://zrzutka.pl/rd7ssx/pay"
            title="Wpłać jednorazowo na Zrzutce"
            desc="Bez zakładania konta i bez zobowiązań."
            ink="ink-warning"
            access="none"
            @click="trackGoal('cta:donate', { to: 'zrzutka' })"
          />
        </v-col>
      </v-row>
      <!-- A caption and not a card: /profil says outright that the newsletter
           is „w przygotowaniu”, and advertising an unbuilt feature as a way to
           help costs the whole list its credibility. -->
      <p class="text-caption text-medium-emphasis mt-3 mb-0">
        Newsletter jeszcze nie ruszył - w profilu możesz już zaznaczyć, o czym
        chcesz dostawać wiadomości, a odezwiemy się, gdy będzie gotowy.
        <v-btn
          variant="text"
          size="small"
          class="text-none"
          color="ink-info"
          text="Ustaw w profilu"
          @click="openNewsletter"
        />
      </p>
    </section>

    <!-- Piszesz kod? -->
    <section id="kod" class="pomoc__section">
      <div class="sec-head">
        <h2 class="text-h6">Piszesz kod?</h2>
        <span class="text-caption text-medium-emphasis">Na dłużej</span>
        <InfoBubble label="Piszesz kod?">
          Nuxt i Vue po stronie serwisu, Python po stronie danych. Instrukcja
          uruchomienia jest w README. Jeśli nie masz konta na GitHubie, a chcesz
          coś zgłosić - użyj przycisku „Zgłoś” w prawym dolnym rogu, trafi do
          nas tak samo.
        </InfoBubble>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Cały serwis i pipeline danych są otwarte.
      </p>
      <v-row>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiGithub"
            href="https://github.com/SzymonPajzert/koryta"
            title="Przejrzyj kod na GitHubie"
            desc="Zerknij, przyślij poprawkę albo po prostu zobacz, jak to jest policzone."
            ink="ink-neutral"
            access="none"
            @click="trackGoal('cta:community', { to: 'github' })"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4">
          <CardAction
            :icon="mdiCodeTags"
            href="https://github.com/SzymonPajzert/koryta/issues/new"
            title="Zgłoś błąd techniczny"
            desc="Jeśli masz konto na GitHubie, to najszybsza droga."
            ink="ink-neutral"
            access="none"
            @click="trackGoal('cta:community', { to: 'github-issue' })"
          />
        </v-col>
      </v-row>
    </section>

    <!-- Częste pytania. The accordion is the third and last level of
         disclosure on this page, and the only one that hides a paragraph. -->
    <section id="faq" class="pomoc__section">
      <h2 class="text-h6 mb-3">Częste pytania</h2>
      <v-expansion-panels variant="accordion">
        <v-expansion-panel v-for="entry in faq" :key="entry.q" :title="entry.q">
          <template #text>
            <div class="text-body-2" style="white-space: pre-line">
              {{ entry.a }}
            </div>
          </template>
        </v-expansion-panel>
      </v-expansion-panels>
      <p class="text-caption text-medium-emphasis mt-3 mb-0">
        Nie ma tu Twojego pytania? Napisz - przycisk zgłoszenia jest w prawym
        dolnym rogu każdej strony.
      </p>
    </section>

    <DialogProposeEditNode
      ref="proposeDialog"
      :key="proposeType"
      :create-type="proposeType"
      hide-activator
    />
    <DialogLogin
      v-model="loginDialog"
      hide-activator
      @success="navigateTo('/profil')"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import {
  mdiAccountPlusOutline,
  mdiAccountQuestionOutline,
  mdiAccountSearchOutline,
  mdiCheckDecagramOutline,
  mdiClockOutline,
  mdiCodeTags,
  mdiDomainPlus,
  mdiEmailOutline,
  mdiFacebook,
  mdiGithub,
  mdiHeartOutline,
  mdiHelpCircleOutline,
  mdiLayersSearchOutline,
  mdiLinkVariant,
  mdiLinkVariantPlus,
  mdiMapMarkerOutline,
  mdiMessageAlertOutline,
  mdiPencilOutline,
  mdiPiggyBankOutline,
  mdiShareVariantOutline,
  mdiSlack,
  mdiSwapVertical,
  mdiTagOutline,
  mdiTextBoxSearchOutline,
  mdiThumbsUpDown,
  mdiToolboxOutline,
} from "@mdi/js";
import { useAuthState } from "@/composables/auth";
import { useStats } from "~/composables/stats/useStats";
import { useFeedbackDialog } from "~/composables/feedbackDialog";
import { trackGoal } from "~/composables/analytics";
import { noteKindConfig } from "~/composables/notes";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import type { HelpTask } from "~~/shared/analytics";
import type { ProposableNodeType } from "~~/shared/api";

/** Every way a person can help, on one page, in the order of what it costs
 * them.
 *
 * The page it replaces listed six things, three of which were an outbound link
 * to somebody else's site, and it opened with „Nie potrzebujesz konta ani
 * doświadczenia - możesz zacząć od razu” directly above two links that both
 * carry the auth middleware. The things it did not mention included the „Zgłoś”
 * button - which needs no account, works anonymously, lands straight in the
 * admin queue, and is how most of the feedback this rework answers arrived -
 * the one-off fundraiser, /qa, /zrodla, and every note and change proposal on
 * a person's own page.
 *
 * The rule that keeps it from growing back into prose: no card carries more
 * than one sentence. Anything longer goes behind the heading's „(i)”, and the
 * contract there is `PageSection`'s - nothing a reader needs in order to use
 * the section belongs in the bubble.
 */

const VOLUNTEER_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform";

definePageMeta({
  title: "Jak możesz pomóc",
  isHelp: true,
  layout: "gray",
  fullWidth: true,
});

useSeoMeta({
  title: "Jak możesz pomóc - Koryta.pl",
  description:
    "Sześć sposobów, żeby pomóc: zgłoś nam coś w minutę, dopisz brakującą osobę albo spółkę, sprawdzaj kolejkę, dołącz do zespołu, wesprzyj finansowo albo przyślij poprawkę do kodu. Przy każdej rzeczy piszemy, czy trzeba konta.",
});

const { total, approved, reviewed, toCheck } = useStats();
const checked = computed(() => approved.value + reviewed.value);

const task = (name: HelpTask) =>
  trackGoal("cta:task", { task: name, from: "pomoc" });

const tiles = [
  {
    path: "minuta",
    title: "Mam minutę",
    desc: "Zgłoś nam coś albo podeślij komuś link. Bez konta.",
    icon: mdiClockOutline,
    ink: "ink-sage",
  },
  {
    path: "wiem-cos",
    title: "Wiem coś o konkretnej spółce albo osobie",
    desc: "Dopisz to, czego u nas nie ma.",
    icon: mdiMapMarkerOutline,
    ink: "ink-info",
  },
  {
    path: "sprawdzanie",
    title: "Chcę sprawdzać dane",
    desc: "Przejrzyj kolejkę i oceniaj, czy posadę tłumaczy polityka.",
    icon: mdiLayersSearchOutline,
    ink: "ink-info",
  },
  {
    path: "zespol",
    title: "Umiem coś, co się przyda",
    desc: "Powiedz nam, co potrafisz - dobierzemy zadanie.",
    icon: mdiToolboxOutline,
    ink: "ink-sage",
  },
  {
    path: "pieniadze",
    title: "Mogę dorzucić się finansowo",
    desc: "Serwery, domena i rejestry kosztują.",
    icon: mdiPiggyBankOutline,
    ink: "ink-warning",
  },
  {
    path: "kod",
    title: "Piszę kod",
    desc: "Cały serwis jest otwarty na GitHubie.",
    icon: mdiCodeTags,
    ink: "ink-neutral",
  },
] as const;

const checkingCards = computed(() => [
  {
    icon: mdiLayersSearchOutline,
    title: "Przeglądaj nowe osoby",
    // The count is dropped rather than printed as 0 when /api/stats/progress
    // has not answered: „Do sprawdzenia: 0” is the one number that would talk a
    // reader out of the task this card exists to hand them.
    desc:
      "Kolejka osób, których nikt jeszcze nie sprawdzał." +
      (toCheck.value ? ` Do sprawdzenia: ${polishNumber(toCheck.value)}.` : ""),
    to: "/eksploruj/nowe",
    task: "kolejka" as const,
  },
  {
    icon: mdiTextBoxSearchOutline,
    title: "Oceniaj fakty z artykułów",
    desc: "Model wyciąga z tekstów pojedyncze zdania o czyjejś posadzie, a Ty mówisz, czy trafił: poprawne, za mało informacji albo błędne.",
    to: "/ekstrakcje/kategoryzacja",
    task: "fakty" as const,
  },
  {
    icon: mdiAccountSearchOutline,
    title: "Oceniaj fakty przy osobie, która Cię interesuje",
    desc: "Nie musisz brać całej kolejki - na stronie osoby, w sekcji „Fakty z artykułów”, oceniasz tylko to, co Cię dotyczy.",
    to: "/eksploruj/tabela",
    task: "fakty-osoby" as const,
  },
  {
    // Open to every signed-in reader, and linked only from /admin until now -
    // invisible to exactly the people it asks to test things.
    icon: mdiCheckDecagramOutline,
    title: "Sprawdź, czy nowości działają",
    desc: "Lista ostatnich zmian na stronie, z krokami do przeklikania. Mówisz, czy działa, albo zgłaszasz, co poszło nie tak.",
    to: "/qa",
    task: "qa" as const,
  },
]);

// The three note kinds take their wording from `noteKindConfig` rather than a
// second copy of it, so this page and the buttons a reader then meets say the
// same words.
const inPlace = [
  {
    icon: mdiThumbsUpDown,
    title: "Oceń, na ile osoba jest ciekawa",
    subtitle: "Strzałki przy nazwisku, w skali od -5 do +5.",
  },
  {
    icon: mdiPencilOutline,
    title: "Zaproponuj zmianę w metryczce",
    subtitle:
      "Imię i nazwisko, partia, data urodzenia, linki do Wikipedii czy KRS-u.",
  },
  {
    icon: mdiLinkVariant,
    title: noteKindConfig.source.addLabel,
    subtitle: noteKindConfig.source.hint,
  },
  {
    icon: mdiPencilOutline,
    title: noteKindConfig.change_request.addLabel,
    subtitle: noteKindConfig.change_request.hint,
  },
  {
    icon: mdiHelpCircleOutline,
    title: noteKindConfig.missing.addLabel,
    subtitle: noteKindConfig.missing.hint,
  },
  {
    icon: mdiSwapVertical,
    title: "Popraw albo dodaj powiązanie",
    subtitle: "Daty, stanowisko, nowa praca, spółka zależna.",
  },
  {
    icon: mdiTagOutline,
    title: "Otaguj artykuł",
    subtitle:
      "Przypisz go do tematu albo dopisz osobę, o której jest w nim mowa.",
  },
  {
    icon: mdiAccountQuestionOutline,
    title: "Zgłoś, że fakt dotyczy imiennika",
    subtitle: "Jedno kliknięcie: „To nie ta osoba”.",
  },
];

const faq = [
  {
    q: "Czy muszę mieć konto?",
    a: "Do zgłoszenia błędu, podesłania komuś linku, ankiety wolontariusza i wpłaty - nie. Do oceniania osób i faktów oraz do notatek i propozycji zmian - tak, bo każda taka zmiana ma autora i historię. Konto zakładasz w niecałą minutę, a po zalogowaniu wracasz dokładnie w to miejsce, z którego klikasz.",
  },
  {
    q: "Czy muszę się na czymś znać?",
    a: "Nie. Przy każdej osobie masz jej historię zatrudnienia i artykuły, w których się pojawia - tyle wystarczy, żeby ocenić, czy posada wygląda na polityczną. Jeśli nie masz pewności, przejdź do następnej osoby; nikt nie wymaga od Ciebie pewności.",
  },
  {
    q: "Skąd bierzecie dane?",
    a: "Z Krajowego Rejestru Sądowego, z innych publicznych rejestrów i z artykułów prasowych. Powiązania, które ktoś dodał na podstawie artykułu, mają przy sobie klikalne źródło; reszta pochodzi wprost z rejestrów, więc sprawdzisz ją w KRS-ie po numerze spółki.",
  },
  {
    q: "Co liczą Wasze modele?",
    a:
      "Trzy rzeczy - i żadna z nich niczego nie publikuje.\n\n" +
      "• Model czytający artykuły wyciąga z nich pojedyncze zdania o konkretnych osobach. To są „fakty”, które potem oceniają ludzie.\n" +
      "• Model dopasowania łączy nazwisko z artykułu z osobą w bazie. Dopasowuje po samym nazwisku, więc czasem trafi w imiennika - dlatego przy każdym fakcie jest przycisk „To nie ta osoba”.\n" +
      "• Model oceny stawia przy osobie liczbę od -5 do +5 - tę samą, którą stawiają ludzie - i mówi tylko, jak bardzo warto się jej przyjrzeć. Ustawia kolejność w kolejce i nic poza tym.\n\n" +
      "Publikuje zawsze człowiek.",
  },
  {
    q: "Co się dzieje z tym, co zgłoszę?",
    a: "Notatki i propozycje zmian trafiają do kolejki, którą przegląda redakcja. O decyzji przy propozycji zmiany dostajesz maila, a swoje propozycje widzisz na swoim profilu. Notatka zostaje tam, gdzie ją napisałeś - przy osobie albo spółce.",
  },
  {
    q: "Czy to jest wymierzone w jedną partię?",
    a: "Nie. W bazie są ludzie ze wszystkich ugrupowań, które rządziły, i z samorządów wszystkich opcji. Jeśli uważasz, że po którejś stronie czegoś brakuje - to jest dokładnie ta pomoc, o którą prosimy. Zgłoś to.",
  },
];

// The dialog the floating „Zgłoś” button already mounted, not a second copy.
const feedbackOpen = useFeedbackDialog();
const openFeedback = () => {
  task("zglos");
  feedbackOpen.value = true;
};

// Opened here rather than described - „idź na stronę osoby i tam znajdź
// przycisk” is not a way to add somebody who is not on the site yet.
//
// Keyed by type, so the dialog is a fresh instance once the type changes: it
// resolves `type` once from its props and renders that form for its whole life.
// Open it after Vue has swapped the instance in - the same dance OmniSearch
// does, and for the same reason.
const proposeDialog = ref<{ open: () => void } | null>(null);
const proposeType = ref<ProposableNodeType>("person");
const openPropose = async (type: ProposableNodeType) => {
  task(type === "person" ? "dodaj-osobe" : "dodaj-spolke");
  proposeType.value = type;
  await nextTick();
  proposeDialog.value?.open();
};

const { user } = useAuthState();
const loginDialog = ref(false);
const openNewsletter = () => {
  if (user.value) {
    navigateTo("/profil");
  } else {
    loginDialog.value = true;
  }
};
</script>

<style scoped>
.pomoc__section {
  margin-top: 40px;
  /* Clear of the sticky app bar, so a tile's anchor does not land the heading
     underneath it. On the target rather than the scroller, which is what makes
     it work here at all - the element that scrolls is `html`, and a scoped
     rule cannot reach it. */
  scroll-margin-top: 96px;
}
</style>

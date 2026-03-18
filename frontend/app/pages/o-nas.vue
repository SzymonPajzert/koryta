<template>
  <v-container class="py-8">
    <!-- Hero / Nasza misja -->
    <v-row align="center" class="mb-12">
      <v-col cols="12" md="8">
        <h1 class="text-h3 font-weight-bold mb-4">Nasza misja</h1>
        <p class="text-h6 text-grey-darken-1 mb-6">
          Przekształcamy rozproszone dane w czytelną mapę powiązań, by każdy
          obywatel mógł świadomie oceniać jakość zarządzania majątkiem
          publicznym.
        </p>
      </v-col>
      <v-col cols="12" md="4" class="text-md-right">
        <v-btn
          color="primary"
          class="text-display-small"
          href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
        >
          Dołącz do wolontariuszy
        </v-btn>
      </v-col>
    </v-row>

    <v-divider class="mb-12"></v-divider>

    <!-- O projekcie -->
    <section class="mb-16">
      <h2 class="text-h4 font-weight-bold mb-6">O projekcie</h2>
      <v-row>
        <v-col cols="12" md="6">
          <p class="text-body-1 mb-4">
            <strong>Koryta.pl</strong> powstały z powszechnej niezgody na
            działania polityków, którzy obsadzają swoich znajomych i rodzinę na
            stanowiskach w publicznych spółkach. Pieniądze podatników, zamiast
            być wydane na publiczne cele, trafiają do kieszeni partyjniaków
            bliskich władzy. Choć media regularnie donoszą o tych nadużyciach,
            rozproszenie źródeł informacji utrudnia uchwycenie skali zjawiska.
          </p>
        </v-col>
        <v-col cols="12" md="6">
          <p class="text-body-1">
            My to zmieniamy. Łączymy rozproszone dane w jedno, przejrzyste
            źródło wiedzy – mapę obrazującą powiązania polityczne w państwowych
            spółkach. Naszym celem jest, aby informacja publiczna naprawdę była
            publiczna.
          </p>
        </v-col>
      </v-row>
    </section>

    <!-- Nasze wartości -->
    <section class="mb-16">
      <h2 class="text-h4 font-weight-bold mb-6">Nasze wartości</h2>
      <v-row>
        <v-col cols="12" sm="6">
          <v-card
            height="100%"
            variant="outlined"
            class="d-flex flex-column hover-card"
          >
            <v-card-item>
              <template #prepend>
                <v-icon
                  icon="mdi-eye-outline"
                  size="x-large"
                  color="primary"
                  class="mb-4"
                ></v-icon>
              </template>
              <v-card-title class="font-weight-bold text-wrap"
                >Przejrzystość</v-card-title
              >
            </v-card-item>
            <v-card-text class="flex-grow-1">
              Wszystkie dane, które publikujemy, pochodzą z oficjalnych,
              publicznych źródeł. Każdy wpis posiada odnośnik umożliwiający
              samodzielną weryfikację. Dodatkowo projekt opiera się na zasadach
              open-source, co zapewnia pełną transparentność naszych działań.
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6">
          <v-card
            height="100%"
            variant="outlined"
            class="d-flex flex-column hover-card"
          >
            <v-card-item>
              <template #prepend>
                <v-icon
                  icon="mdi-scale-balance"
                  size="x-large"
                  color="primary"
                  class="mb-4"
                ></v-icon>
              </template>
              <v-card-title class="font-weight-bold text-wrap"
                >Bezstronność</v-card-title
              >
            </v-card-item>
            <v-card-text class="flex-grow-1">
              Nie faworyzujemy żadnej opcji politycznej. Naszym jedynym
              kryterium jest rzetelność i dostępność danych. Punktujemy
              nadużycia każdej władzy, prowadząc analizy niezależnie od barw
              partyjnych.
              <div class="mt-2">
                <a
                  to="/"
                  class="text-primary text-decoration-none font-weight-medium"
                  >Zobacz porównanie z innymi stronami</a
                >
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6">
          <v-card
            height="100%"
            variant="outlined"
            class="d-flex flex-column hover-card"
          >
            <v-card-item>
              <template #prepend>
                <v-icon
                  icon="mdi-shield-check-outline"
                  size="x-large"
                  color="primary"
                  class="mb-4"
                ></v-icon>
              </template>
              <v-card-title class="font-weight-bold text-wrap"
                >Niezależność</v-card-title
              >
            </v-card-item>
            <v-card-text class="flex-grow-1">
              Nie przyjmujemy dotacji od partii politycznych ani organizacji z
              nimi powiązanych. Projekt jest finansowany wyłącznie przez
              darczyńców i Pracownię Ogniw Społecznych.
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6">
          <v-card
            height="100%"
            variant="outlined"
            class="d-flex flex-column hover-card"
          >
            <v-card-item>
              <template #prepend>
                <v-icon
                  icon="mdi-account-group-outline"
                  size="x-large"
                  color="primary"
                  class="mb-4"
                ></v-icon>
              </template>
              <v-card-title class="font-weight-bold text-wrap"
                >Społeczność</v-card-title
              >
            </v-card-item>
            <v-card-text class="flex-grow-1">
              Koryta.pl jest projektem, do którego każdy może się zgłosić.
              Budujemy go wspólnie z wolontariuszami, którzy wierzą w prawo
              obywateli do informacji.
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </section>

    <!-- Kim jesteśmy i Zespół -->
    <section class="mb-16 bg-grey-lighten-4 rounded-xl py-10 px-6 px-md-10">
      <v-row>
        <v-col cols="12" md="5">
          <h2 class="text-h4 font-weight-bold mb-4">Kim jesteśmy?</h2>
          <p class="text-body-1 mb-6">
            Tworzymy zespół zaangażowanych obywateli i ekspertów z różnych
            dziedzin, których łączą wspólne wartości. Wierzymy, że zbiorowy
            wysiłek to najskuteczniejszy sposób, by przywrócić kontrolę nad tym,
            jak zarządzane są nasze wspólne pieniądze.
          </p>
        </v-col>
        <v-col cols="12" md="7">
          <h3 class="text-h5 font-weight-bold mb-6">Nasz Zespół</h3>
          <v-card
            variant="flat"
            class="mb-4 d-flex flex-column flex-sm-row bg-transparent"
          >
            <v-avatar
              size="80"
              color="grey-lighten-2"
              class="mr-sm-4 mb-4 mb-sm-0 mt-2 elevation-2"
            >
              <v-icon
                icon="mdi-account"
                size="x-large"
                color="grey-darken-1"
              ></v-icon>
            </v-avatar>
            <div>
              <div class="text-h6 font-weight-bold">Szymon Pajzert</div>
              <div class="text-subtitle-2 text-primary mb-2">
                Założyciel / pierwszy wolontariusz
              </div>
              <p class="text-body-2 text-justify text-sm-left">
                Kandydował z list Lewicy do samorządu w 2024 roku, ale po
                przegranych wyborach nie dostał nigdzie ciepłej posadki. Z
                wykształcenia informatyk. Aktualnie w swojej działalności skupia
                się na zwalczaniu nadużyć władzy. Wcześniej walczył z
                samochodozą i ocieplającą się planetą.
              </p>
            </div>
          </v-card>
        </v-col>

        <v-col cols="12">
          <p class="text-body-1 font-weight-medium mb-4 text-center">
            Koryta.pl to przede wszystkim społeczność. Naszą prawdziwą siłę
            stanowi dynamiczna grupa wolontariuszy – pasjonatów i ekspertów,
            którzy poświęcają swój czas, by wspólnie budować narzędzie
            przejrzystości.
          </p>
        </v-col>
        <v-col cols="12" md="5">
          <p class="text-body-1 mb-8">
            Skład naszego zespołu jest otwarty: dołączają do niego osoby o
            różnych umiejętnościach, kiedy akurat mają przestrzeń, by działać.
            To właśnie dzięki tej różnorodności i nieustannemu dopływowi nowej
            energii możemy skutecznie monitorować powiązania polityczne w
            spółkach skarbu państwa.
          </p>
        </v-col>
        <v-col cols="12" md="7" class="align-center">
          <v-card
            variant="outlined"
            border="dashed opacity-50"
            class="d-flex align-center justify-center py-8 bg-transparent"
            min-height="120"
            href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
          >
            <div class="text-center text-grey-darken-1">
              <v-icon
                icon="mdi-account-plus-outline"
                size="large"
                class="mb-2"
              ></v-icon>
              <br />
              Buduj ten projekt razem z nami
            </div>
          </v-card>
        </v-col>
      </v-row>
    </section>

    <!-- Jak pracujemy? -->
    <section class="mb-16">
      <h2 class="text-h4 font-weight-bold text-center mb-10">Jak pracujemy?</h2>
      <v-row>
        <v-col cols="12" sm="6" lg="3">
          <div class="text-center px-4">
            <v-avatar
              size="64"
              color="primary-lighten-4"
              class="mb-4 text-primary font-weight-bold text-h5 shadow-sm"
            >
              1
            </v-avatar>
            <h3 class="text-h6 font-weight-bold mb-2">Zbieramy</h3>
            <p class="text-body-2 text-grey-darken-2">
              Pozyskujemy dane z publicznych rejestrów i źródeł, wykorzystując
              zaawansowaną automatyzację oraz rzetelną pracę manualną.
            </p>
          </div>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <div class="text-center px-4">
            <v-avatar
              size="64"
              color="primary-lighten-4"
              class="mb-4 text-primary font-weight-bold text-h5 shadow-sm"
            >
              2
            </v-avatar>
            <h3 class="text-h6 font-weight-bold mb-2">Łączymy</h3>
            <p class="text-body-2 text-grey-darken-2">
              Wykorzystanie zaawansowanych algorytmów wspieranych ekspercką
              analizą pozwala precyzyjnie łączyć osoby z konkretnymi
              instytucjami i partiami.
            </p>
          </div>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <div class="text-center px-4">
            <v-avatar
              size="64"
              color="primary-lighten-4"
              class="mb-4 text-primary font-weight-bold text-h5 shadow-sm"
            >
              3
            </v-avatar>
            <h3 class="text-h6 font-weight-bold mb-2">Weryfikujemy</h3>
            <p class="text-body-2 text-grey-darken-2">
              Każdy wpis przechodzi audyt. Użytkownicy mogą zgłaszać błędy.
            </p>
          </div>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <div class="text-center px-4">
            <v-avatar
              size="64"
              color="primary-lighten-4"
              class="mb-4 text-primary font-weight-bold text-h5 shadow-sm"
            >
              4
            </v-avatar>
            <h3 class="text-h6 font-weight-bold mb-2">Udostępniamy</h3>
            <p class="text-body-2 text-grey-darken-2">
              Wszystkie zgromadzone przez nas dane są publiczne, darmowe i w
              pełni dostępne dla każdego obywatela.
            </p>
          </div>
        </v-col>
      </v-row>
    </section>

    <!-- FAQ -->
    <section class="mb-16">
      <h2 class="text-h4 font-weight-bold text-center mb-8">
        Często zadawane pytania
      </h2>
      <v-row justify="center">
        <v-col cols="12" md="8">
          <v-expansion-panels variant="accordion">
            <v-expansion-panel>
              <v-expansion-panel-title class="font-weight-medium text-body-1"
                >Skąd bierzecie dane?</v-expansion-panel-title
              >
              <v-expansion-panel-text class="text-body-2 pt-2">
                Korzystamy z publicznych rejestrów (KRS, BIP), oświadczeń
                majątkowych, mediów i dokumentów urzędowych. Łącznie agregujemy
                dane z 9+ źródeł.
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel>
              <v-expansion-panel-title class="font-weight-medium text-body-1"
                >Czy mogę zweryfikować dostępne na stronie
                informacje?</v-expansion-panel-title
              >
              <v-expansion-panel-text class="text-body-2 pt-2">
                Tak. Przy każdym wpisie podajemy źródło. Zachęcamy do
                samodzielnej weryfikacji - to fundament naszego projektu.
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel>
              <v-expansion-panel-title class="font-weight-medium text-body-1"
                >Jak mogę pomóc?</v-expansion-panel-title
              >
              <v-expansion-panel-text class="text-body-2 pt-2">
                Możesz dołączyć jako wolontariusz, zgłosić błąd, zasugerować
                nowe źródło danych lub wesprzeć nas finansowo. Każda pomoc się
                liczy.
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel>
              <v-expansion-panel-title class="font-weight-medium text-body-1"
                >Czy projekt ma afiliacje polityczne?</v-expansion-panel-title
              >
              <v-expansion-panel-text class="text-body-2 pt-2">
                Nie. Nie mamy żadnych powiązań z partiami politycznymi.
                Monitorujemy wszystkie ugrupowania z równą uwagą.
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-col>
      </v-row>
    </section>

    <!-- Kontakt -->
    <section class="text-center py-10 mb-8 border rounded-xl bg-grey-lighten-4">
      <h2 class="text-h4 font-weight-bold mb-4">
        Dołącz do naszej społeczności
      </h2>
      <p class="text-body-1 mb-8 text-grey-darken-1">
        Zmieniajmy wspólnie jakość życia w Polsce. Masz pytania? Napisz do nas
        na
        <a
          href="mailto:kontakt@koryta.pl"
          class="text-primary font-weight-bold text-decoration-none"
          >kontakt@koryta.pl</a
        >.
      </p>
      <v-btn
        color="primary"
        size="x-large"
        elevation="2"
        href="https://docs.google.com/forms/d/e/1FAIpQLSfZX4ekzLEhX60f6Frn3JMKkYwbqG2tE1NNNN0Eu_Ozr814FQ/viewform"
      >
        Dołącz do Koryta.pl
      </v-btn>
    </section>
  </v-container>
</template>

<script setup lang="ts">
useSeoMeta({
  title: "O nas - Koryta.pl",
  description:
    "Przekształcamy rozproszone dane w czytelną mapę powiązań, by każdy obywatel mógł świadomie oceniać jakość zarządzania majątkiem publicznym.",
});
</script>

<style scoped>
.hover-card {
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}
.hover-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08) !important;
}
</style>

<template>
  <v-col cols="12" md="8">
    <HomeCard height="100%">
      <template #header> Co tutaj robimy? </template>
      Polskie partie oskarżają się od lat o koryciarstwo - ale kto robi go
      najwięcej? Koryta.pl to największy, ogólnopolski i bezpartyjny agregator
      informacji o politycznych układach. Znajdziesz w nim polityków i ich
      bliskich, którzy pracują w publicznych spółkach.
      <!-- TODO VSCode is autoadding breaks here, I don't know why -->
      <br /><br />
      Te dane są oficjalnie publiczne i dostępne, jednak trzeba wiedzieć, czego
      szukać. My wiemy i szukamy. Zobacz film o projekcie na
      <a href="https://youtu.be/x20MFMDUAuk">YouTube</a>.
    </HomeCard>
  </v-col>
  <v-col cols="12" md="4">
    <HomeCard height="100%">
      ❤️ Robimy ten projekt z miłości do przejrzystej i publicznej informacji.
      Nie mamy sponsorów ani partyjnego wsparcia.
      <br />
      <br />
      <strong>
        Jeśli chcesz pomóc w rozbiciu politycznego betonu, wesprzyj nas:
      </strong>
      <v-container class="d-flex flex-wrap ga-2 pa-2">
        <v-spacer />
        <v-btn
          href="https://patronite.pl/romb.me"
          target="_blank"
          color="white"
        >
          <v-img
            :width="30"
            aspect-ratio="16/9"
            cover
            src="@/assets/patronite.png"
          />
        </v-btn>
        <v-btn
          href="https://zrzutka.pl/rd7ssx/pay"
          target="_blank"
          color="#E64164"
        >
          <v-img
            :width="30"
            aspect-ratio="16/9"
            cover
            src="@/assets/zrzutka.png"
          />
        </v-btn>
        <v-btn
          href="https://github.com/SzymonPajzert/koryta"
          target="_blank"
          color="white"
        >
          <v-img
            :width="30"
            aspect-ratio="16/9"
            cover
            src="@/assets/github.svg"
          />
        </v-btn>
        <v-spacer />
      </v-container>
    </HomeCard>
  </v-col>
</template>

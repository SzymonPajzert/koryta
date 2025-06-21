<template>
  <p>
    Niniejsza strona została utworzona na podstawie materiałów prasowych,
    informacji zawartych w Krajowym Rejestrze Sądowym, a także w oparciu o inne
    ogólnodostępne źródła.
    Strona wskazuje wybrane powiązania o charakterze
    biznesowym, rodzinnym lub innym łączące niektóre osoby zatrudnione w
    spółkach, fundacjach i organizacjach zarządzanych przez organy polskiego
    państwa. Powiązanie, które zdołaliśmy ustalić i które w naszej opinii są
    istotne dla całościowego spojrzenia na proces wybierania ludzi na stanowiska
    poza konkursami. Zastrzegamy, że celem strony nie jest twierdzenie, że
    wszystkie osoby uwidocznione na mapie działają wspólnie lub w porozumieniu,
    jak również przesądzanie o czyjejkolwiek osobistej winie lub
    odpowiedzialności prawnej.
  </p>
  Źródła tej strony to między innymi:
  <ul>
    <li v-for="source in sources" :key="source.title">
      <a href="{{ source.sourceURL }}">{{source.domain}}</a> - {{ source.title }}
    </li>
  </ul>
  <br>
  <a href="https://www.flaticon.com/free-icons/pork" title="pork icons">
    Pork icons created by Freepik - Flaticon
  </a>
  <a href="https://www.flaticon.com/free-icon/pig_3800575"> - link</a>
</template>

<script lang="ts" setup>
import { useRTDB } from '@vueuse/firebase/useRTDB'
import { db } from '@/firebase'
import { ref as dbRef } from 'firebase/database'


interface Source {
  title: string;
  sourceURL: string;
  status?: {confirmedDone: boolean}
}

const sourcesInData = useRTDB<Record<string, Source>>(dbRef(db, 'data'))

const sources = computed(() =>
  Object.values(sourcesInData.value ?? {})
    .filter(source => source.status?.confirmedDone)
    .map(source => ({
    ...source,
    domain: new URL(source.sourceURL).hostname
  })))

</script>
